import type { PlayerDTO } from "../../../shared/api.ts";
import { formatCents } from "../format.ts";
import type { ConnectionStatus } from "../net/GameSocket.ts";

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connecting: "Conectando",
  open: "Ao vivo",
  reconnecting: "Reconectando",
};

export function TopBar({ player, status }: { player: PlayerDTO | null; status: ConnectionStatus }) {
  return (
    <header className="topbar">
      <div className="brand">
        <span aria-hidden>🚀</span> Rocket Crash
      </div>
      <div className="topbar-right">
        <span className={`conn conn-${status}`} title={STATUS_LABEL[status]}>
          <span className="dot" /> <span className="conn-label">{STATUS_LABEL[status]}</span>
        </span>
        {player && (
          <div className="wallet">
            <span className="wallet-name">{player.name}</span>
            <strong className="wallet-balance">{formatCents(player.balanceCents)}</strong>
          </div>
        )}
      </div>
    </header>
  );
}
