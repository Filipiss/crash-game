// Perfil do jogador: tipos e VALIDAÇÃO compartilhados.
// O mesmo código valida no navegador (feedback imediato no formulário) e no
// servidor (a garantia de verdade). Uma regra só = impossível os dois discordarem.
//
// Os dados pessoais são FICTÍCIOS, gerados para demonstração (e-mails @example.com).

export interface ProfileStats {
  bets: number;
  wageredCents: number;
  wonCents: number;
  /** Maior multiplicador em que saiu com lucro, ou null se ainda não ganhou nenhuma. */
  bestMultiplier: number | null;
}

/** GET/PUT /api/players/me/profile */
export interface ProfileDTO {
  playerId: string;
  /** Apelido público (o nome que aparece no jogo). Gerado pelo servidor. */
  nickname: string;
  fullName: string;
  email: string;
  phone: string;
  city: string;
  /** Quando a conta foi criada (epoch ms), só para exibir a data. */
  memberSince: number;
  stats: ProfileStats;
}

/** Campos que o jogador pode editar. */
export interface UpdateProfileRequest {
  fullName: string;
  email: string;
  phone: string;
  city: string;
}

export type ProfileErrors = Partial<Record<keyof UpdateProfileRequest, string>>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Retorna um erro por campo inválido (objeto vazio = tudo certo). */
export function validateProfile(input: UpdateProfileRequest): ProfileErrors {
  const errors: ProfileErrors = {};
  const fullName = input.fullName.trim();
  if (fullName.length < 3 || fullName.length > 60) errors.fullName = "O nome deve ter entre 3 e 60 caracteres.";

  const email = input.email.trim();
  if (!EMAIL_RE.test(email) || email.length > 100) errors.email = "Informe um e-mail válido.";

  const digits = input.phone.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 13 || /[^\d\s()+-]/.test(input.phone)) {
    errors.phone = "Telefone com DDD, só números (ex.: (11) 91234-5678).";
  }

  const city = input.city.trim();
  if (city.length < 2 || city.length > 60) errors.city = "A cidade deve ter entre 2 e 60 caracteres.";
  return errors;
}

/** Limpa espaços extras antes de salvar. */
export function normalizeProfile(input: UpdateProfileRequest): UpdateProfileRequest {
  return {
    fullName: input.fullName.trim().replace(/\s+/g, " "),
    email: input.email.trim().toLowerCase(),
    phone: input.phone.trim(),
    city: input.city.trim(),
  };
}
