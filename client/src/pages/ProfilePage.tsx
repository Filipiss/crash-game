import { useEffect, useState } from "react";
import { Link } from "react-router";
import {
  validateProfile,
  type ProfileDTO,
  type ProfileErrors,
  type UpdateProfileRequest,
} from "../../../shared/profile.ts";
import { Avatar } from "../components/Avatar.tsx";
import { formatCents, formatMultiplier } from "../format.ts";
import type { Session } from "../hooks/useSession.ts";
import { api } from "../net/api.ts";

/** Executa uma ação REST com tratamento de erro padronizado (vem do App). */
export type RunAction = <T>(action: (token: string) => Promise<T>) => Promise<T | null>;

interface Props {
  session: Session | null;
  run: RunAction;
  onOpenDeposit: () => void;
  onSaved: () => void;
}

/** Nível "VIP" pelo total apostado: só um detalhe de gamificação, calculado no cliente. */
const LEVELS = [
  { name: "Bronze", icon: "🥉", minCents: 0 },
  { name: "Prata", icon: "🥈", minCents: 50_000 },
  { name: "Ouro", icon: "🥇", minCents: 200_000 },
  { name: "Diamante", icon: "💎", minCents: 1_000_000 },
];

function levelFor(wageredCents: number) {
  let index = 0;
  LEVELS.forEach((level, i) => {
    if (wageredCents >= level.minCents) index = i;
  });
  const current = LEVELS[index]!;
  const next = LEVELS[index + 1] ?? null;
  const progress = next ? (wageredCents - current.minCents) / (next.minCents - current.minCents) : 1;
  return { current, next, progress: Math.min(1, Math.max(0, progress)) };
}

const FIELDS: { key: keyof UpdateProfileRequest; label: string; type: string; inputMode?: "email" | "tel" | "text"; autoComplete: string }[] = [
  { key: "fullName", label: "Nome completo", type: "text", autoComplete: "name" },
  { key: "email", label: "E-mail", type: "email", inputMode: "email", autoComplete: "email" },
  { key: "phone", label: "Telefone", type: "tel", inputMode: "tel", autoComplete: "tel" },
  { key: "city", label: "Cidade", type: "text", autoComplete: "address-level2" },
];

/** Rota "/perfil": dados (fictícios) do jogador e estatísticas reais das apostas dele. */
export function ProfilePage({ session, run, onOpenDeposit, onSaved }: Props) {
  const [profile, setProfile] = useState<ProfileDTO | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<UpdateProfileRequest>({ fullName: "", email: "", phone: "", city: "" });
  const [errors, setErrors] = useState<ProfileErrors>({});
  const [saving, setSaving] = useState(false);
  const token = session?.token;

  useEffect(() => {
    document.title = "Meu perfil · Rocket Crash";
  }, []);

  // Busca o perfil ao abrir a página (e de novo se a sessão mudar).
  // `cancelled` evita atualizar o estado se o jogador saiu da página antes da resposta.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    api
      .getProfile(token)
      .then((data) => {
        if (!cancelled) setProfile(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Erro ao carregar o perfil.");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  function startEditing() {
    if (!profile) return;
    setForm({ fullName: profile.fullName, email: profile.email, phone: profile.phone, city: profile.city });
    setErrors({});
    setEditing(true);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    // Mesma validação do servidor (shared/profile.ts): o erro aparece sem ir à rede.
    const found = validateProfile(form);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSaving(true);
    const updated = await run((t) => api.updateProfile(t, form));
    setSaving(false);
    if (!updated) return;
    setProfile(updated);
    setEditing(false);
    onSaved();
  }

  if (!session || (!profile && !loadError)) {
    return <main className="profile-page loading-page">Carregando perfil…</main>;
  }
  if (!profile) {
    return (
      <main className="profile-page loading-page">
        <p>{loadError}</p>
        <Link to="/">Voltar ao jogo</Link>
      </main>
    );
  }

  const { stats } = profile;
  const profitCents = stats.wonCents - stats.wageredCents;
  const level = levelFor(stats.wageredCents);
  const memberSince = new Date(profile.memberSince).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });

  return (
    <main className="profile-page">
      <Link to="/" className="back-link">
        ← Voltar ao jogo
      </Link>

      <section className="card profile-identity">
        <Avatar name={profile.nickname} seed={profile.playerId} size={88} />
        <h1>{profile.nickname}</h1>
        <p className="muted">Membro desde {memberSince}</p>

        <div className="level">
          <div className="level-head">
            <span>
              {level.current.icon} Nível {level.current.name}
            </span>
            {level.next && <span className="muted">próximo: {level.next.name}</span>}
          </div>
          <div className="level-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level.progress * 100)}>
            <span style={{ width: `${level.progress * 100}%` }} />
          </div>
          {level.next && (
            <small className="muted">Aposte mais {formatCents(level.next.minCents - stats.wageredCents)} para subir</small>
          )}
        </div>

        <div className="identity-balance">
          <span className="muted">Saldo</span>
          <strong>{formatCents(session.player.balanceCents)}</strong>
          <button type="button" className="pay-btn" onClick={onOpenDeposit}>
            Recarregar
          </button>
        </div>
      </section>

      <div className="profile-main">
        <section className="stats-grid" aria-label="Estatísticas">
          <div className="card stat">
            <span className="muted">Apostas</span>
            <strong>{stats.bets}</strong>
          </div>
          <div className="card stat">
            <span className="muted">Total apostado</span>
            <strong>{formatCents(stats.wageredCents)}</strong>
          </div>
          <div className="card stat">
            <span className="muted">Total ganho</span>
            <strong>{formatCents(stats.wonCents)}</strong>
          </div>
          <div className="card stat">
            <span className="muted">Lucro</span>
            <strong className={profitCents >= 0 ? "positive" : "negative"}>
              {profitCents >= 0 ? "+" : "−"}
              {formatCents(Math.abs(profitCents))}
            </strong>
          </div>
          <div className="card stat">
            <span className="muted">Maior multiplicador</span>
            <strong>{stats.bestMultiplier !== null ? formatMultiplier(stats.bestMultiplier) : "—"}</strong>
          </div>
        </section>

        <section className="card profile-form-card">
          <header className="profile-form-head">
            <h2>Dados pessoais</h2>
            {!editing && (
              <button type="button" className="ghost-btn" onClick={startEditing}>
                ✏️ Editar
              </button>
            )}
          </header>
          <p className="demo-note">🧪 Dados fictícios, gerados para demonstração. Nada aqui é real.</p>

          {editing ? (
            <form className="profile-form" onSubmit={(e) => void save(e)} noValidate>
              {FIELDS.map((field) => (
                <label key={field.key} className="form-field">
                  <span>{field.label}</span>
                  <input
                    type={field.type}
                    inputMode={field.inputMode}
                    autoComplete={field.autoComplete}
                    value={form[field.key]}
                    onChange={(e) => setForm((f) => ({ ...f, [field.key]: e.target.value }))}
                    aria-invalid={errors[field.key] !== undefined}
                    aria-describedby={errors[field.key] ? `${field.key}-error` : undefined}
                  />
                  {errors[field.key] && (
                    <small id={`${field.key}-error`} className="form-error">
                      {errors[field.key]}
                    </small>
                  )}
                </label>
              ))}
              <div className="form-actions">
                <button type="button" className="ghost-btn" onClick={() => setEditing(false)} disabled={saving}>
                  Cancelar
                </button>
                <button type="submit" className="pay-btn" disabled={saving}>
                  {saving ? "Salvando…" : "Salvar"}
                </button>
              </div>
            </form>
          ) : (
            <dl className="profile-data">
              <div>
                <dt>Apelido no jogo</dt>
                <dd>{profile.nickname}</dd>
              </div>
              {FIELDS.map((field) => (
                <div key={field.key}>
                  <dt>{field.label}</dt>
                  <dd>{profile[field.key]}</dd>
                </div>
              ))}
              <div>
                <dt>ID do jogador</dt>
                <dd className="mono">{profile.playerId.slice(0, 8)}…</dd>
              </div>
            </dl>
          )}
        </section>
      </div>
    </main>
  );
}
