// Matemática da curva, compartilhada.
// O servidor usa para validar cash-outs; o cliente usa para animar a 60fps
// entre uma mensagem "tick" e outra (interpolação).

/** Velocidade de crescimento. Com 0.00006: ~1.82x em 10s, ~6x em 30s. */
export const GROWTH_RATE = 0.00006;

/** Multiplicador exato após `elapsedMs` de voo: cresce exponencialmente a partir de 1. */
export function multiplierAt(elapsedMs: number): number {
  return Math.exp(GROWTH_RATE * Math.max(0, elapsedMs));
}

/** O inverso: quantos ms leva para a curva chegar em `multiplier`. */
export function msToReach(multiplier: number): number {
  return Math.log(multiplier) / GROWTH_RATE;
}

/** Arredonda PARA BAIXO em 2 casas (2.3789 -> 2.37). Nunca a favor do jogador por erro de float. */
export function floorMultiplier(multiplier: number): number {
  return Math.floor(multiplier * 100) / 100;
}
