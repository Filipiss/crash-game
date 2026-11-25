import type { Winner } from "../../../shared/protocol.ts";
import { formatCents, formatMultiplier, formatTime } from "../format.ts";
import { Avatar } from "./Avatar.tsx";

/** Tabela "Ganhadores ao vivo": cada cash-out de qualquer jogador aparece aqui na hora (via WebSocket). */
export function LiveWinners({ winners, myId }: { winners: Winner[]; myId: string | undefined }) {
  return (
    <section className="winners">
      <h2 className="section-title">
        <span>Ganhadores ao vivo</span>
      </h2>

      <div className="card winners-card">
        <div className="winners-row winners-head" role="row">
          <span>Jogador</span>
          <span className="col-time">Hora</span>
          <span>Aposta</span>
          <span>Multiplicador</span>
          <span className="col-right">Ganho</span>
        </div>

        {winners.length === 0 && <p className="winners-empty">Ninguém ganhou ainda. Que tal ser o primeiro?</p>}

        {winners.map((win) => (
          // roundId + playerId identifica um ganho de forma única (1 aposta por jogador por rodada)
          <div key={`${win.roundId}-${win.playerId}`} className={`winners-row ${win.playerId === myId ? "me" : ""}`} role="row">
            <span className="winner-player">
              <Avatar name={win.playerName} seed={win.playerId} size={28} />
              <span className="winner-name">
                {win.playerName}
                {win.playerId === myId && <em> (você)</em>}
              </span>
            </span>
            <span className="col-time muted">{formatTime(win.at)}</span>
            <span>{formatCents(win.amountCents)}</span>
            <span>
              <span className="mult-badge">{formatMultiplier(win.multiplier)}</span>
              {win.auto && <span className="auto-badge">auto</span>}
            </span>
            <span className="col-right payout">+{formatCents(win.payoutCents)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
