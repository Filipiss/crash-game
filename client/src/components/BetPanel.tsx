import { useEffect, useRef, useState } from "react";
import { MAX_BET_CENTS, MIN_BET_CENTS } from "../../../shared/api.ts";
import { floorMultiplier } from "../../../shared/crash-math.ts";
import type { PublicBet } from "../../../shared/protocol.ts";
import { centsToInput, formatCents, formatMultiplier, parseInputToCents } from "../format.ts";
import type { GameState } from "../game/state.ts";

interface Props {
  game: GameState;
  myBet: PublicBet | null;
  balanceCents: number | null;
  connected: boolean;
  pending: boolean;
  onBet: (amountCents: number) => void;
  onCashout: () => void;
  onRefill: () => void;
}

/** O que o botão principal faz e mostra AGORA. Uma pequena máquina de estados da UI. */
interface MainAction {
  label: string;
  sub: string;
  kind: "bet" | "cashout" | "waiting" | "won" | "refill";
  onClick?: () => void;
}

const QUICK_AMOUNTS = [500, 1_000, 5_000, 10_000];

export function BetPanel({ game, myBet, balanceCents, connected, pending, onBet, onCashout, onRefill }: Props) {
  const [amountText, setAmountText] = useState(centsToInput(1_000));
  const amountCents = parseInputToCents(amountText);
  const balance = balanceCents ?? 0;

  // Validação no cliente = feedback IMEDIATO para o jogador.
  // (O servidor valida de novo: a validação do cliente é UX, não segurança.)
  let amountError: string | null = null;
  if (amountCents === null) amountError = "Valor inválido";
  else if (amountCents < MIN_BET_CENTS) amountError = `Mínimo ${formatCents(MIN_BET_CENTS)}`;
  else if (amountCents > MAX_BET_CENTS) amountError = `Máximo ${formatCents(MAX_BET_CENTS)}`;
  else if (amountCents > balance) amountError = "Saldo insuficiente";

  const setAmount = (cents: number) => setAmountText(centsToInput(Math.max(MIN_BET_CENTS, Math.min(MAX_BET_CENTS, cents))));

  const action = getMainAction();
  const disabled = !action.onClick || pending || !connected;

  function getMainAction(): MainAction {
    if (!connected) return { label: "Conectando…", sub: "aguarde", kind: "waiting" };
    if (balanceCents === null) return { label: "Carregando…", sub: "criando sua conta", kind: "waiting" };

    if (myBet?.cashedOutAt != null) {
      const payout = Math.floor(myBet.amountCents * myBet.cashedOutAt);
      return { label: `Você saiu em ${formatMultiplier(myBet.cashedOutAt)}`, sub: `+${formatCents(payout)}`, kind: "won" };
    }

    switch (game.phase) {
      case "betting":
        if (myBet) return { label: "Aposta feita", sub: "aguardando decolagem…", kind: "waiting" };
        if (balance < MIN_BET_CENTS) return { label: "Recarregar fichas", sub: "saldo acabou", kind: "refill", onClick: onRefill };
        return {
          label: "Apostar",
          sub: amountError ?? (amountCents !== null ? formatCents(amountCents) : ""),
          kind: "bet",
          onClick: amountError || amountCents === null ? undefined : () => onBet(amountCents),
        };
      case "running":
        if (myBet) {
          // Valor confirmado pelo servidor (último tick), não o interpolado, e arredondado
          // para baixo com a MESMA regra que o servidor usa para pagar: nunca prometemos a mais.
          const potential = Math.floor(myBet.amountCents * floorMultiplier(game.multiplier));
          return { label: "Cash out", sub: formatCents(potential), kind: "cashout", onClick: onCashout };
        }
        return { label: "Rodada em andamento", sub: "aposte na próxima", kind: "waiting" };
      case "crashed":
        return { label: "Próxima rodada", sub: "em instantes…", kind: "waiting" };
    }
  }

  // INPUT pelo teclado: Espaço aciona o botão principal (apostar / cash out).
  // A ref garante que o listener (criado uma vez) sempre veja a ação mais recente.
  const actionRef = useRef<(() => void) | undefined>(undefined);
  useEffect(() => {
    actionRef.current = disabled ? undefined : action.onClick;
  });
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.code !== "Space" || event.repeat) return;
      // Num campo de texto o espaço é digitação; num botão focado o navegador já "clica".
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLButtonElement) return;
      event.preventDefault(); // não rolar a página
      actionRef.current?.();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const canEditAmount = game.phase !== "running" && !myBet;

  return (
    <section className="panel bet-panel">
      <div className="amount">
        <label className="amount-field">
          <span>Valor da aposta</span>
          <div className="amount-input">
            <span className="currency">R$</span>
            <input
              inputMode="decimal" // teclado numérico no celular
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
              onBlur={() => amountCents !== null && setAmountText(centsToInput(amountCents))}
              disabled={!canEditAmount}
              aria-invalid={amountError !== null}
            />
            <button type="button" onClick={() => amountCents && setAmount(Math.floor(amountCents / 2))} disabled={!canEditAmount}>
              ½
            </button>
            <button type="button" onClick={() => amountCents && setAmount(Math.min(balance, amountCents * 2))} disabled={!canEditAmount}>
              2×
            </button>
          </div>
        </label>
        <div className="quick">
          {QUICK_AMOUNTS.map((cents) => (
            <button key={cents} type="button" onClick={() => setAmount(cents)} disabled={!canEditAmount}>
              {formatCents(cents).replace(",00", "")}
            </button>
          ))}
        </div>
      </div>

      <button type="button" className={`action-btn action-${action.kind}`} onClick={action.onClick} disabled={disabled}>
        <span className="action-label">{pending ? "Enviando…" : action.label}</span>
        <span className="action-sub">{action.sub}</span>
      </button>
      <p className="hint">
        Dica: <kbd>Espaço</kbd> aposta e faz cash out
      </p>
    </section>
  );
}
