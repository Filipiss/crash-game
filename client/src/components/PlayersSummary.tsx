import type { PublicBet } from "../../../shared/protocol.ts";
import { formatCents } from "../format.ts";
import { Avatar } from "./Avatar.tsx";

const MAX_AVATARS = 4;

/** Resumo da sala: quem está online, quem apostou e quanto está em jogo nesta rodada. */
export function PlayersSummary({ bets, online }: { bets: PublicBet[]; online: number }) {
  const bankCents = bets.reduce((sum, bet) => sum + bet.amountCents, 0);
  const shown = bets.slice(0, MAX_AVATARS);
  const extra = bets.length - shown.length;

  return (
    <section className="players-summary">
      <div className="summary-row">
        <span className="card-title">
          <span className="title-icon" aria-hidden>
            👥
          </span>{" "}
          Jogadores
        </span>
        <span className="summary-right">
          <strong>{online}</strong> online
        </span>
      </div>

      <div className="summary-row">
        <span className="field-label">Apostaram nesta rodada</span>
        <span className="avatar-stack">
          {shown.map((bet) => (
            <Avatar key={bet.playerId} name={bet.playerName} seed={bet.playerId} size={26} />
          ))}
          {extra > 0 && <span className="avatar avatar-more">+{extra}</span>}
          {bets.length === 0 && <span className="muted">ninguém ainda</span>}
        </span>
      </div>

      <div className="bank">
        <span className="field-label">Banca da rodada</span>
        <strong className="bank-value">{formatCents(bankCents)}</strong>
      </div>
    </section>
  );
}
