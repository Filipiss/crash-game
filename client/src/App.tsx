import { useCallback, useEffect, useRef, useState } from "react";
import { BetPanel } from "./components/BetPanel.tsx";
import { GameCanvas } from "./components/GameCanvas.tsx";
import { HistoryBar } from "./components/HistoryBar.tsx";
import { PlayersList } from "./components/PlayersList.tsx";
import { Toasts } from "./components/Toasts.tsx";
import { TopBar } from "./components/TopBar.tsx";
import { formatCents, formatMultiplier } from "./format.ts";
import { useGameSocket } from "./hooks/useGameSocket.ts";
import { useSession } from "./hooks/useSession.ts";
import { useToasts } from "./hooks/useToasts.ts";
import { api, ApiError } from "./net/api.ts";

/**
 * Fluxo de dados do app:
 *   WebSocket -> useGameSocket -> `game` (estado da rodada, de todo mundo)
 *   REST      -> useSession    -> `session` (quem sou eu e meu saldo)
 *   Botões    -> api.bet / api.cashout -> servidor -> WebSocket -> `game` atualiza
 */
export function App() {
  const { game, status } = useGameSocket();
  const { session, error: sessionError, refresh, setBalance, replacePlayer } = useSession();
  const { toasts, push } = useToasts();
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);

  const myId = session?.player.id;
  // "Minha aposta" não é um estado separado: é DERIVADA da lista que vem do WebSocket.
  // Uma única fonte da verdade = impossível as duas versões discordarem.
  const myBet = game.bets.find((bet) => bet.playerId === myId) ?? null;

  // Reconectou depois de cair (ex.: servidor reiniciou)? Revalida a sessão e o saldo.
  const prevStatus = useRef(status);
  useEffect(() => {
    if (status === "open" && prevStatus.current === "reconnecting") void refresh();
    prevStatus.current = status;
  }, [status, refresh]);

  // Feedback de derrota: a rodada crashou com a minha aposta ainda no foguete.
  const lostRoundRef = useRef(0);
  useEffect(() => {
    if (game.phase !== "crashed" || !myBet || myBet.cashedOutAt !== null) return;
    if (lostRoundRef.current === game.roundId) return; // avisa só uma vez por rodada
    lostRoundRef.current = game.roundId;
    push("loss", `💥 Crash em ${formatMultiplier(game.crashPoint ?? 1)}. Você perdeu ${formatCents(myBet.amountCents)}.`);
  }, [game.phase, game.roundId, game.crashPoint, myBet, push]);

  /**
   * Executa uma ação REST com: trava contra clique duplo, tratamento de erro
   * padronizado e recuperação de sessão expirada.
   */
  const run = useCallback(
    async <T,>(action: (token: string) => Promise<T>): Promise<T | null> => {
      // ref (síncrona) e não só state: dois cliques no mesmo frame veriam o state antigo
      if (!session || pendingRef.current) return null;
      pendingRef.current = true;
      setPending(true);
      try {
        return await action(session.token);
      } catch (err) {
        if (err instanceof ApiError && err.code === "UNAUTHORIZED") {
          await refresh();
          push("info", "Sua sessão expirou (o servidor reiniciou). Criamos uma nova: tente de novo.");
        } else {
          push("error", err instanceof Error ? err.message : "Erro inesperado.");
        }
        return null;
      } finally {
        pendingRef.current = false;
        setPending(false);
      }
    },
    [session, refresh, push],
  );

  const placeBet = async (amountCents: number) => {
    const res = await run((token) => api.bet(token, amountCents));
    if (res) setBalance(res.balanceCents);
  };

  const cashOut = async () => {
    const res = await run((token) => api.cashout(token));
    if (!res) return;
    setBalance(res.balanceCents);
    push("win", `🚀 Saiu em ${formatMultiplier(res.multiplier)}! +${formatCents(res.payoutCents)}`);
  };

  const refill = async () => {
    const player = await run((token) => api.refill(token));
    if (player) {
      replacePlayer(player);
      push("info", `Fichas recarregadas: ${formatCents(player.balanceCents)}`);
    }
  };

  return (
    <div className="app">
      <TopBar player={session?.player ?? null} status={status} />

      <main className="layout">
        <section className="stage">
          <HistoryBar history={game.history} />
          <div className="canvas-wrap">
            <GameCanvas state={game} />
            {status !== "open" && <div className="canvas-overlay">Reconectando ao servidor…</div>}
          </div>
          <BetPanel
            game={game}
            myBet={myBet}
            balanceCents={session?.player.balanceCents ?? null}
            connected={status === "open"}
            pending={pending}
            onBet={placeBet}
            onCashout={cashOut}
            onRefill={refill}
          />
          {sessionError && <p className="session-error">Não foi possível criar sua conta: {sessionError}</p>}
        </section>

        <aside className="sidebar">
          <PlayersList bets={game.bets} phase={game.phase} myId={myId} />
        </aside>
      </main>

      <Toasts toasts={toasts} />
    </div>
  );
}
