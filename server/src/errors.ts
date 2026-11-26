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
  INVALID_AUTO_CASHOUT: 400,
  INSUFFICIENT_FUNDS: 400,
  BETTING_CLOSED: 409, // 409 Conflict: o pedido é válido, mas conflita com o estado atual do jogo
  ALREADY_BET: 409,
  NO_ACTIVE_BET: 409,
  ROUND_NOT_RUNNING: 409,
  ALREADY_CASHED_OUT: 409,
  TOO_LATE: 409,
  INVALID_DEPOSIT: 400,
  INVALID_PAYMENT_METHOD: 400,
  INVALID_PROMO: 404, // 404: esse código promocional "não existe"
  BONUS_COOLDOWN: 429, // 429 Too Many Requests: "calma, tente de novo mais tarde"
  INVALID_PROFILE: 400,
  NOT_FOUND: 404,
  INTERNAL: 500,
};
