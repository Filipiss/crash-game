import { useEffect, useRef, useState } from "react";
import { MAX_AUTO_CASHOUT, MAX_BET_CENTS, MIN_AUTO_CASHOUT, MIN_BET_CENTS } from "../../../shared/api.ts";
import { floorMultiplier } from "../../../shared/crash-math.ts";
import type { PublicBet } from "../../../shared/protocol.ts";
import { centsToInput, formatCents, formatMultiplier, parseInputToCents, parseMultiplierInput } from "../format.ts";
import type { GameState } from "../game/state.ts";

/** O que o jogador quer apostar (agora ou na próxima rodada). */
export interface BetIntent {
  amountCents: number;
  autoCashoutAt: number | null;
}

interface Props {
  game: GameState;
  myBet: PublicBet | null;
  myAutoTarget: number | null;
  queued: BetIntent | null;
  balanceCents: number | null;
  connected: boolean;
  pending: boolean;
  onBet: (intent: BetIntent) => void;
  onCancelQueued: () => void;
  onCashout: () => void;
  onRefill: () => void;
}

/** O que o botão principal faz e mostra AGORA. Uma pequena máquina de estados da UI. */
interface MainAction {
  label: string;
  sub: string;
  kind: "bet" | "cashout" | "waiting" | "won" | "refill" | "queued";
  onClick?: () => void;
}

const AUTO_PRESETS = [1.5, 2, 10];

export function BetPanel(props: Props) {
  const { game, myBet, myAutoTarget, queued, balanceCents, connected, pending } = props;
  const [amountText, setAmountText] = useState(centsToInput(1_000));
  const [autoEnabled, setAutoEnabled] = useState(false);
  const [autoText, setAutoText] = useState("2,00");

  const balance = balanceCents ?? 0;
  const amountCents = parseInputToCents(amountText);
  const autoValue = parseMultiplierInput(autoText);

  // Validação no cliente = feedback IMEDIATO para o jogador.
  // (O servidor valida de novo: a validação do cliente é UX, não segurança.)
  let amountError: string | null = null;
  if (amountCents === null) amountError = "Valor inválido";
  else if (amountCents < MIN_BET_CENTS) amountError = `Mínimo ${formatCents(MIN_BET_CENTS)}`;
  else if (amountCents > MAX_BET_CENTS) amountError = `Máximo ${formatCents(MAX_BET_CENTS)}`;
  else if (amountCents > balance) amountError = "Saldo insuficiente";

  let autoError: string | null = null;
  if (autoEnabled && (autoValue === null || autoValue < MIN_AUTO_CASHOUT || autoValue > MAX_AUTO_CASHOUT)) {
    autoError = `Auto entre ${MIN_AUTO_CASHOUT}x e ${MAX_AUTO_CASHOUT}x`;
  }

  const intent: BetIntent | null =
    amountError || autoError || amountCents === null ? null : { amountCents, autoCashoutAt: autoEnabled ? autoValue : null };

  const setAmount = (cents: number) => setAmountText(centsToInput(Math.max(MIN_BET_CENTS, Math.min(MAX_BET_CENTS, cents))));
  const autoLabel = (target: number | null) => (target !== null ? ` · auto ${formatMultiplier(target)}` : "");

  const action = getMainAction();
  const disabled = !action.onClick || pending || !connected;

  function betAction(nextRound: boolean): MainAction {
    if (balance < MIN_BET_CENTS) return { label: "Recarregar fichas", sub: "seu saldo acabou", kind: "refill", onClick: props.onRefill };
    return {
      label: nextRound ? "Apostar (próxima rodada)" : "Apostar",
      sub: amountError ?? autoError ?? `${formatCents(amountCents ?? 0)}${autoLabel(intent?.autoCashoutAt ?? null)}`,
      kind: "bet",
      onClick: intent ? () => props.onBet(intent) : undefined,
    };
  }

  function getMainAction(): MainAction {
    if (!connected) return { label: "Conectando…", sub: "aguarde", kind: "waiting" };
    if (balanceCents === null) return { label: "Carregando…", sub: "criando sua conta", kind: "waiting" };

    if (myBet?.cashedOutAt != null) {
      const payout = Math.floor(myBet.amountCents * myBet.cashedOutAt);
      return { label: `Você saiu em ${formatMultiplier(myBet.cashedOutAt)}`, sub: `+${formatCents(payout)}`, kind: "won" };
    }
    if (queued) {
      return {
        label: "Cancelar aposta",
        sub: `${formatCents(queued.amountCents)}${autoLabel(queued.autoCashoutAt)} na próxima rodada`,
        kind: "queued",
        onClick: props.onCancelQueued,
      };
    }

    switch (game.phase) {
      case "betting":
        if (myBet) return { label: "Aposta feita", sub: `aguardando decolagem…${autoLabel(myAutoTarget)}`, kind: "waiting" };
        return betAction(false);
      case "running":
        if (myBet) {
          // Valor confirmado pelo servidor (último tick), não o interpolado, e arredondado
          // para baixo com a MESMA regra que o servidor usa para pagar: nunca prometemos a mais.
          const potential = Math.floor(myBet.amountCents * floorMultiplier(game.multiplier));
          return { label: "Cash out", sub: `${formatCents(potential)}${autoLabel(myAutoTarget)}`, kind: "cashout", onClick: props.onCashout };
        }
        return betAction(true);
      case "crashed":
        return betAction(true);
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

  // Com aposta em jogo (ou agendada), os campos travam: o que vale é o que foi enviado.
  const locked = myBet !== null || queued !== null;

  return (
    <section className="bet-panel">
      <header className="card-title">
        <span className="title-dot" /> Aposta
      </header>

      <label className="field">
        <span className="field-label">Valor da aposta</span>
        <div className="input-row" data-invalid={amountError !== null}>
          <span className="input-prefix">R$</span>
          <input
            inputMode="decimal" // teclado numérico no celular
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
            onBlur={() => amountCents !== null && setAmountText(centsToInput(amountCents))}
            disabled={locked}
            aria-label="Valor da aposta"
          />
          <div className="chips">
            <button type="button" onClick={() => amountCents && setAmount(Math.floor(amountCents / 2))} disabled={locked}>
              ½
            </button>
            <button type="button" onClick={() => amountCents && setAmount(Math.min(balance, amountCents * 2))} disabled={locked}>
              2×
            </button>
            <button type="button" className="chip-strong" onClick={() => setAmount(balance)} disabled={locked || balance < MIN_BET_CENTS}>
              Máx
            </button>
          </div>
        </div>
      </label>

      <div className="field">
        <div className="field-label field-label-row">
          <span>Auto cash out</span>
          <button
            type="button"
            role="switch"
            aria-checked={autoEnabled}
            className={`switch ${autoEnabled ? "on" : ""}`}
            onClick={() => setAutoEnabled((v) => !v)}
            disabled={locked}
            aria-label="Ativar auto cash out"
          >
            <span className="switch-knob" />
          </button>
        </div>
        <div className="input-row" data-invalid={autoError !== null} data-off={!autoEnabled}>
          <span className="input-prefix">x</span>
          <input
            inputMode="decimal"
            value={autoText}
            onChange={(e) => setAutoText(e.target.value)}
            onFocus={() => setAutoEnabled(true)}
            disabled={locked}
            aria-label="Multiplicador do auto cash out"
          />
          <div className="chips">
            {AUTO_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                className={autoEnabled && autoValue === preset ? "chip-strong" : ""}
                onClick={() => {
                  setAutoText(preset.toFixed(2).replace(".", ","));
                  setAutoEnabled(true);
                }}
                disabled={locked}
              >
                {preset}x
              </button>
            ))}
          </div>
        </div>
      </div>

      <button type="button" className={`action-btn action-${action.kind}`} onClick={action.onClick} disabled={disabled}>
        <span className="action-label">{pending ? "Enviando…" : action.label}</span>
        <span className="action-sub">{action.sub}</span>
      </button>
      <p className="hint">
        <kbd>Espaço</kbd> aposta e faz cash out
      </p>
    </section>
  );
}
