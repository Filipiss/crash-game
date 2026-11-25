import { randomInt, randomUUID } from "node:crypto";
import type { PlayerDTO } from "../../shared/api.ts";
import { AppError } from "./errors.ts";

const STARTING_BALANCE_CENTS = 1_000_00; // R$ 1.000,00 de fichas de mentira

export interface Player {
  id: string; // público: pode aparecer para outros jogadores
  token: string; // secreto: prova que "eu sou este jogador"
  name: string;
  balanceCents: number;
}

const ANIMALS = ["Onça", "Tucano", "Arara", "Capivara", "Jaguar", "Sucuri", "Preguiça", "Macaco"];
const TRAITS = ["Veloz", "Audaz", "Feliz", "Valente", "Sagaz", "Ágil"];
const pick = <T>(list: T[]): T => list[randomInt(list.length)]!;

/**
 * Guarda os jogadores EM MEMÓRIA (um Map). Se o servidor reiniciar, tudo some.
 * Num produto real seria um banco de dados; a interface (create/debit/credit)
 * continuaria igual, só a implementação mudaria.
 */
export class PlayerStore {
  private byToken = new Map<string, Player>();

  create(): Player {
    const player: Player = {
      id: randomUUID(),
      token: randomUUID(),
      name: `${pick(ANIMALS)} ${pick(TRAITS)} ${randomInt(10, 100)}`,
      balanceCents: STARTING_BALANCE_CENTS,
    };
    this.byToken.set(player.token, player);
    return player;
  }

  findByToken(token: string): Player | undefined {
    return this.byToken.get(token);
  }

  debit(player: Player, cents: number): void {
    if (cents > player.balanceCents) {
      throw new AppError("INSUFFICIENT_FUNDS", "Saldo insuficiente.");
    }
    player.balanceCents -= cents;
  }

  credit(player: Player, cents: number): void {
    player.balanceCents += cents;
  }

  /** Fichas de volta para quem zerou (é um protótipo, não um cassino de verdade). */
  refill(player: Player): void {
    player.balanceCents = STARTING_BALANCE_CENTS;
  }
}

/** Converte para o formato público: o token NUNCA sai daqui por engano. */
export function toPlayerDTO(player: Player): PlayerDTO {
  return { id: player.id, name: player.name, balanceCents: player.balanceCents };
}
