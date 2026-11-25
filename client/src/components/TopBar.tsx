import type { PlayerDTO } from "../../../shared/api.ts";
import { formatCents } from "../format.ts";
import type { ConnectionStatus } from "../net/GameSocket.ts";
import { Avatar } from "./Avatar.tsx";

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connecting: "Conectando",
  open: "Ao vivo",
  reconnecting: "Reconectando",
};

interface Props {
  player: PlayerDTO | null;
  status: ConnectionStatus;
  canRefill: boolean;
  onRefill: () => void;
}

export function TopBar({ player, status, canRefill, onRefill }: Props) {
  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="brand">
          <span className="brand-logo" aria-hidden>
            🚀
          </span>
          <span>
            Rocket <strong>Crash</strong>
          </span>
        </div>

        {/* Card de "recompensa": recarga grátis de fichas quando o saldo acaba */}
        <button type="button" className="rewards" onClick={onRefill} disabled={!canRefill}>
          <span className="rewards-icon" aria-hidden>
            🎁
          </span>
          <span className="rewards-text">
            <strong>Fichas grátis</strong>
            <small>{canRefill ? "Toque para recarregar!" : "Quando o saldo acabar"}</small>
          </span>
        </button>
      </div>

      <div className="topbar-right">
        <span className={`conn conn-${status}`} title={STATUS_LABEL[status]}>
          <span className="dot" />
          <span className="conn-label">{STATUS_LABEL[status]}</span>
        </span>

        {player && (
          <>
            <div className="balance-pill">
              <span className="balance-value">{formatCents(player.balanceCents)}</span>
              <button
                type="button"
                className="balance-add"
                onClick={onRefill}
                disabled={!canRefill}
                title={canRefill ? "Recarregar fichas" : "Disponível quando o saldo acabar"}
                aria-label="Recarregar fichas"
              >
                +
              </button>
            </div>
            <div className="me-chip">
              <Avatar name={player.name} seed={player.id} size={36} />
              <span className="me-name">{player.name}</span>
            </div>
          </>
        )}
      </div>
    </header>
  );
}
