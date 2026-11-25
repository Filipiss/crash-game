import type { PublicBet, RoundPhase } from "../../../shared/protocol.ts";
import { formatCents, formatMultiplier } from "../format.ts";

interface Props {
  bets: PublicBet[];
  phase: RoundPhase;
  myId: string | undefined;
}

/** Apostas da rodada ao vivo (vêm do WebSocket: de todos os jogadores conectados). */
export function PlayersList({ bets, phase, myId }: Props) {
  const totalCents = bets.reduce((sum, bet) => sum + bet.amountCents, 0);
  // Minha aposta sempre no topo; depois, as maiores.
  const sorted = [...bets].sort((a, b) => Number(b.playerId === myId) - Number(a.playerId === myId) || b.amountCents - a.amountCents);

  return (
    <section className="panel players">
      <header className="players-header">
        <h2>Jogadores</h2>
        <span>
          {bets.length} · {formatCents(totalCents)}
        </span>
      </header>

      {bets.length === 0 ? (
        <p className="players-empty">Ninguém apostou nesta rodada ainda.</p>
      ) : (
        <ul>
          {sorted.map((bet) => {
            const cashed = bet.cashedOutAt !== null;
            const lost = !cashed && phase === "crashed";
            return (
              <li key={bet.playerId} className={`player ${bet.playerId === myId ? "me" : ""} ${cashed ? "won" : ""} ${lost ? "lost" : ""}`}>
                <span className="player-name">
                  {bet.playerName}
                  {bet.playerId === myId && <em> (você)</em>}
                </span>
                <span className="player-amount">{formatCents(bet.amountCents)}</span>
                <span className="player-result">
                  {cashed
                    ? `${formatMultiplier(bet.cashedOutAt!)} · +${formatCents(Math.floor(bet.amountCents * bet.cashedOutAt!))}`
                    : lost
                      ? "perdeu"
                      : "—"}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
