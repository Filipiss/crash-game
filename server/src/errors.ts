import type { ErrorCode } from "../../shared/api.ts";

/**
 * Erro "esperado" de regra de negócio (aposta fora de hora, saldo insuficiente...).
 * Diferente de um bug: vira uma resposta 4xx bonitinha, não um 500.
 */
export class AppError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

/** Qual status HTTP cada código de erro gera. */
export const STATUS_BY_CODE: Record<ErrorCode, number> = {
  UNAUTHORIZED: 401, // não sei quem você é
  INVALID_BODY: 400, // pedido mal formado
  INVALID_AMOUNT: 400,
  INSUFFICIENT_FUNDS: 400,
  BETTING_CLOSED: 409, // 409 Conflict: o pedido é válido, mas conflita com o estado atual do jogo
  ALREADY_BET: 409,
  NO_ACTIVE_BET: 409,
  ROUND_NOT_RUNNING: 409,
  ALREADY_CASHED_OUT: 409,
  TOO_LATE: 409,
  REFILL_NOT_ALLOWED: 409,
  INTERNAL: 500,
};
