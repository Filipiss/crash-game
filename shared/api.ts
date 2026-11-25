// Contrato da REST API: formatos de pedido e resposta, compartilhados.
//
// Dinheiro é SEMPRE em centavos inteiros (1050 = R$ 10,50).
// Em ponto flutuante, 0.1 + 0.2 = 0.30000000000000004. Com saldo, isso vira bug.
//
// IMPORTANTE: tudo aqui é FICHA VIRTUAL. Não existe dinheiro real nem pagamento real.

export const MIN_BET_CENTS = 100; // R$ 1,00
export const MAX_BET_CENTS = 100_000; // R$ 1.000,00
export const MIN_AUTO_CASHOUT = 1.01;
export const MAX_AUTO_CASHOUT = 1_000;

/** Recarga simulada de fichas */
export const MIN_DEPOSIT_CENTS = 1_000; // R$ 10,00
export const MAX_DEPOSIT_CENTS = 1_000_000; // R$ 10.000,00
export const DEPOSIT_PACKAGES_CENTS = [3_000, 6_000, 15_000, 30_000, 60_000, 150_000, 300_000, 600_000];
/** Métodos de "pagamento" SIMULADOS: nenhum pede dado real, o servidor só credita fichas. */
export const PAYMENT_METHODS = ["pix", "card", "crypto", "giftcard"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Fichas grátis: valor e intervalo entre resgates */
export const FREE_BONUS_CENTS = 10_000; // R$ 100,00
export const FREE_BONUS_COOLDOWN_MS = 5 * 60_000; // 5 minutos (curto de propósito: é uma demo)

/** Dados públicos de um jogador (nunca inclui o token). */
export interface PlayerDTO {
  id: string;
  name: string;
  balanceCents: number;
  /** Quanto falta para poder resgatar as fichas grátis (0 = já pode). Tempo RELATIVO, imune ao relógio do celular. */
  nextBonusInMs: number;
}

/** POST /api/players */
export interface CreatePlayerResponse {
  /** Segredo da sessão: o cliente guarda e manda em todo pedido (Authorization: Bearer <token>). */
  token: string;
  player: PlayerDTO;
}

/** POST /api/bet */
export interface BetRequest {
  amountCents: number;
  /** Se definido, o SERVIDOR faz o cash-out sozinho exatamente neste multiplicador. */
  autoCashoutAt?: number | null;
}
export interface BetResponse {
  roundId: number;
  amountCents: number;
  autoCashoutAt: number | null;
  balanceCents: number;
}

/** POST /api/cashout */
export interface CashoutResponse {
  multiplier: number;
  payoutCents: number;
  balanceCents: number;
}

/** GET /api/history */
export interface HistoryResponse {
  history: number[];
}

/** POST /api/players/me/bonus */
export interface BonusResponse {
  player: PlayerDTO;
  bonusCents: number;
}

/** GET /api/promo/:code */
export interface PromoResponse {
  code: string;
  bonusPercent: number;
}

/** POST /api/players/me/deposit (recarga SIMULADA) */
export interface DepositRequest {
  amountCents: number;
  method: PaymentMethod;
  promoCode?: string | null;
}
export interface DepositResponse {
  player: PlayerDTO;
  depositedCents: number;
  bonusCents: number;
}

/** Todo erro da API tem este formato, com um código que o cliente pode tratar. */
export type ErrorCode =
  | "UNAUTHORIZED"
  | "INVALID_BODY"
  | "INVALID_AMOUNT"
  | "INVALID_AUTO_CASHOUT"
  | "INSUFFICIENT_FUNDS"
  | "BETTING_CLOSED"
  | "ALREADY_BET"
  | "NO_ACTIVE_BET"
  | "ROUND_NOT_RUNNING"
  | "ALREADY_CASHED_OUT"
  | "TOO_LATE"
  | "INVALID_DEPOSIT"
  | "INVALID_PAYMENT_METHOD"
  | "INVALID_PROMO"
  | "BONUS_COOLDOWN"
  | "INTERNAL";

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string };
}
