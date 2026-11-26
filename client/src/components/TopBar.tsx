import { Link, NavLink } from "react-router";
import { FREE_BONUS_CENTS, type PlayerDTO } from "../../../shared/api.ts";
import { formatCents, formatCountdown } from "../format.ts";
import { useNow } from "../hooks/useNow.ts";
import { Avatar } from "./Avatar.tsx";

interface Props {
  player: PlayerDTO | null;
  bonusReadyAt: number | null;
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

export function TopBar({ player, bonusReadyAt, onClaimBonus, onOpenDeposit }: Props) {
  return (
    <header className="topbar">
      <div className="topbar-left">
        {/* <Link> troca de rota SEM recarregar a página (o WebSocket continua conectado) */}
        <Link to="/" className="brand" aria-label="Rocket Crash: ir para o jogo">
          <span className="brand-logo" aria-hidden>
            🚀
          </span>
          <span>
            Rocket <strong>Crash</strong>
          </span>
        </Link>
        <RewardsCard bonusReadyAt={bonusReadyAt} onClaim={onClaimBonus} />
      </div>

      <div className="topbar-right">
        {player && (
          <>
            <div className="balance-pill">
              <span className="balance-value">{formatCents(player.balanceCents)}</span>
              <button type="button" className="balance-add" onClick={onOpenDeposit} title="Recarregar fichas" aria-label="Recarregar fichas">
                +
              </button>
            </div>
            {/* NavLink sabe se a rota está ativa: ganha a classe "active" quando estamos em /perfil */}
            <NavLink to="/perfil" className="me-chip" title="Meu perfil">
              <Avatar name={player.name} seed={player.id} size={36} />
              <span className="me-name">{player.name}</span>
            </NavLink>
          </>
        )}
      </div>
    </header>
  );
}
