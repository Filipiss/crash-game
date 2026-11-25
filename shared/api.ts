// Contrato da REST API: formatos de pedido e resposta, compartilhados.
//
// Dinheiro é SEMPRE em centavos inteiros (1050 = R$ 10,50).
// Em ponto flutuante, 0.1 + 0.2 = 0.30000000000000004. Com saldo, isso vira bug.

export const MIN_BET_CENTS = 100; // R$ 1,00
export const MAX_BET_CENTS = 100_000; // R$ 1.000,00
export const MIN_AUTO_CASHOUT = 1.01;
export const MAX_AUTO_CASHOUT = 1_000;

/** Dados públicos de um jogador (nunca inclui o token). */
export interface PlayerDTO {
  id: string;
  name: string;
  balanceCents: number;
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
  | "REFILL_NOT_ALLOWED"
  | "INTERNAL";

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string };
}
