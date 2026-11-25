import { useCallback, useEffect, useRef, useState } from "react";
import { MIN_BET_CENTS } from "../../shared/api.ts";
import { BetPanel, type BetIntent } from "./components/BetPanel.tsx";
import { GameCanvas } from "./components/GameCanvas.tsx";
import { HistoryBar } from "./components/HistoryBar.tsx";
import { LiveWinners } from "./components/LiveWinners.tsx";
import { PlayersSummary } from "./components/PlayersSummary.tsx";
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
  /** Aposta feita com a rodada em andamento: fica guardada e é enviada quando abrirem as apostas. */
  const [queued, setQueued] = useState<BetIntent | null>(null);
  /** Alvo de auto cash-out da MINHA aposta (o servidor não divulga o dos outros). */
  const [myAuto, setMyAuto] = useState<{ roundId: number; target: number } | null>(null);

  const myId = session?.player.id;
  // "Minha aposta" não é um estado separado: é DERIVADA da lista que vem do WebSocket.
  // Uma única fonte da verdade = impossível as duas versões discordarem.
  const myBet = game.bets.find((bet) => bet.playerId === myId) ?? null;
  const myAutoTarget = myAuto?.roundId === game.roundId ? myAuto.target : null;
  const balance = session?.player.balanceCents ?? null;
  const hasOpenBet = myBet !== null && myBet.cashedOutAt === null && game.phase !== "crashed";
  const canRefill = balance !== null && balance < MIN_BET_CENTS && !hasOpenBet && !queued;

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

  // Auto cash-out: o servidor me pagou sozinho. Não houve resposta REST,
  // então o aviso vem do WebSocket e o saldo é buscado de novo.
  const autoWinRef = useRef(0);
  const latestWin = game.winners[0];
  useEffect(() => {
    if (!latestWin || latestWin.playerId !== myId || !latestWin.auto) return;
    if (autoWinRef.current === latestWin.roundId) return;
    autoWinRef.current = latestWin.roundId;
    push("win", `🤖 Auto cash-out em ${formatMultiplier(latestWin.multiplier)}! +${formatCents(latestWin.payoutCents)}`);
    void refresh();
  }, [latestWin, myId, push, refresh]);

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

  const sendBet = useCallback(
    async ({ amountCents, autoCashoutAt }: BetIntent) => {
      const res = await run((token) => api.bet(token, amountCents, autoCashoutAt));
      if (!res) return;
      setBalance(res.balanceCents);
      setMyAuto(res.autoCashoutAt !== null ? { roundId: res.roundId, target: res.autoCashoutAt } : null);
    },
    [run, setBalance],
  );

  // Apostas abriram e há uma aposta agendada? Envia agora (uma vez só por rodada).
  const sentQueuedForRound = useRef(0);
  useEffect(() => {
    if (game.phase !== "betting" || !queued || myBet || status !== "open") return;
    if (sentQueuedForRound.current === game.roundId) return;
    sentQueuedForRound.current = game.roundId;
    setQueued(null);
    void sendBet(queued);
  }, [game.phase, game.roundId, queued, myBet, status, sendBet]);

  const placeBet = (intent: BetIntent) => {
    if (game.phase === "betting") void sendBet(intent);
    else setQueued(intent); // rodada em andamento: agenda para a próxima
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
      push("info", `🎁 Fichas recarregadas: ${formatCents(player.balanceCents)}`);
    }
  };

  return (
    <div className="app">
      <TopBar player={session?.player ?? null} status={status} canRefill={canRefill} onRefill={refill} />

      <main className="layout">
        <aside className="side card">
          <BetPanel
            game={game}
            myBet={myBet}
            myAutoTarget={myAutoTarget}
            queued={queued}
            balanceCents={balance}
            connected={status === "open"}
            pending={pending}
            onBet={placeBet}
            onCancelQueued={() => setQueued(null)}
            onCashout={cashOut}
            onRefill={refill}
          />
          <PlayersSummary bets={game.bets} online={game.online} />
          {sessionError && <p className="session-error">Não foi possível criar sua conta: {sessionError}</p>}
        </aside>

        <section className="stage card">
          <HistoryBar history={game.history} />
          <GameCanvas state={game} />
          {status !== "open" && <div className="canvas-overlay">Reconectando ao servidor…</div>}
        </section>

        <LiveWinners winners={game.winners} myId={myId} />
      </main>

      <Toasts toasts={toasts} />
    </div>
  );
}
