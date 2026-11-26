import { useEffect } from "react";
import type { PublicBet } from "../../../shared/protocol.ts";
import { BetPanel, type BetIntent } from "../components/BetPanel.tsx";
import { GameCanvas } from "../components/GameCanvas.tsx";
import { HistoryBar } from "../components/HistoryBar.tsx";
import { LiveWinners } from "../components/LiveWinners.tsx";
import { PlayersSummary } from "../components/PlayersSummary.tsx";
import type { GameState } from "../game/state.ts";
import type { ConnectionStatus } from "../net/GameSocket.ts";

interface Props {
  game: GameState;
  status: ConnectionStatus;
  myId: string | undefined;
  myBet: PublicBet | null;
  myAutoTarget: number | null;
  queued: BetIntent | null;
  balanceCents: number | null;
  pending: boolean;
  sessionError: string | null;
  onBet: (intent: BetIntent) => void;
  onCancelQueued: () => void;
  onCashout: () => void;
  onOpenDeposit: () => void;
}

/**
 * Rota "/": a mesa do jogo. Só recebe dados e ações por props.
 * O estado do jogo e a conexão moram no App, acima das rotas: trocar de página
 * NÃO derruba o WebSocket nem perde o histórico.
 */
export function GamePage(props: Props) {
  const { game, status } = props;

  useEffect(() => {
    document.title = "Rocket Crash";
  }, []);

  return (
    <main className="layout">
      <aside className="side card">
        <BetPanel
          game={game}
          myBet={props.myBet}
          myAutoTarget={props.myAutoTarget}
          queued={props.queued}
          balanceCents={props.balanceCents}
          connected={status === "open"}
          pending={props.pending}
          onBet={props.onBet}
          onCancelQueued={props.onCancelQueued}
          onCashout={props.onCashout}
          onRefill={props.onOpenDeposit}
        />
        <PlayersSummary bets={game.bets} online={game.online} />
        {props.sessionError && <p className="session-error">Não foi possível criar sua conta: {props.sessionError}</p>}
      </aside>

      <section className="stage card">
        <HistoryBar history={game.history} />
        <GameCanvas state={game} />
        {status !== "open" && <div className="canvas-overlay">Reconectando ao servidor…</div>}
      </section>

      <LiveWinners winners={game.winners} myId={props.myId} />
    </main>
  );
}
