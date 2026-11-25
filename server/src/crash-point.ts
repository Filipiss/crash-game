import { randomInt } from "node:crypto";

/** Vantagem da casa: 1%. Isso dá um RTP (retorno ao jogador) de 99%. */
export const HOUSE_EDGE = 0.01;

/**
 * Sorteia em que multiplicador a rodada vai crashar.
 *
 * Fórmula: crash = (1 - edge) / (1 - r), com r uniforme em [0, 1).
 * Consequência: P(crash >= m) = 0.99 / m. Ou seja, qualquer que seja o alvo
 * de cash-out do jogador, o retorno esperado é m * 0.99/m = 0.99.
 *
 * Fica SÓ no servidor: o cliente nunca deve saber como (nem quando) sorteamos.
 */
export function generateCrashPoint(): number {
  // crypto.randomInt é criptograficamente seguro; Math.random() é previsível.
  const r = randomInt(0, 2 ** 32) / 2 ** 32;
  const raw = (1 - HOUSE_EDGE) / (1 - r);
  return Math.max(1, Math.floor(raw * 100) / 100);
}
