import { FREE_BONUS_CENTS, type PlayerDTO } from "../../../shared/api.ts";
import { formatCents, formatCountdown } from "../format.ts";
import { useNow } from "../hooks/useNow.ts";
import type { ConnectionStatus } from "../net/GameSocket.ts";
import { Avatar } from "./Avatar.tsx";

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connecting: "Conectando",
  open: "Ao vivo",
  reconnecting: "Reconectando",
};

interface Props {
  player: PlayerDTO | null;
  bonusReadyAt: number | null;
  status: ConnectionStatus;
  onClaimBonus: () => void;
  onOpenDeposit: () => void;
}

/**
 * Card de fichas grátis com contagem regressiva. É um componente separado de
 * propósito: o useNow re-renderiza A CADA SEGUNDO, e assim só este pedacinho
 * da tela é refeito, não o topo inteiro (nem o app).
 */
function RewardsCard({ bonusReadyAt, onClaim }: { bonusReadyAt: number | null; onClaim: () => void }) {
  const now = useNow(1000, bonusReadyAt !== null);
  const msLeft = bonusReadyAt === null ? Infinity : bonusReadyAt - now;
  const ready = msLeft <= 0;

  return (
    <button type="button" className={`rewards ${ready ? "ready" : ""}`} onClick={onClaim} disabled={!ready}>
      <span className="rewards-icon" aria-hidden>
        🎁
      </span>
      <span className="rewards-text">
        <strong>Fichas grátis</strong>
        <small>{ready ? `Resgatar ${formatCents(FREE_BONUS_CENTS)}` : bonusReadyAt === null ? "…" : `Volta em ${formatCountdown(msLeft)}`}</small>
      </span>
      {ready && <span className="rewards-badge" aria-hidden />}
    </button>
  );
}

export function TopBar({ player, bonusReadyAt, status, onClaimBonus, onOpenDeposit }: Props) {
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
        <RewardsCard bonusReadyAt={bonusReadyAt} onClaim={onClaimBonus} />
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
              <button type="button" className="balance-add" onClick={onOpenDeposit} title="Recarregar fichas" aria-label="Recarregar fichas">
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
