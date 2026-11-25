import { randomInt, randomUUID } from "node:crypto";
import { FREE_BONUS_CENTS, FREE_BONUS_COOLDOWN_MS, type PlayerDTO } from "../../shared/api.ts";
import { AppError } from "./errors.ts";

const STARTING_BALANCE_CENTS = 1_000_00; // R$ 1.000,00 de fichas de mentira

/**
 * Códigos promocionais -> % de bônus na recarga. Ficam SÓ no servidor:
 * se estivessem no cliente, qualquer um veria a lista no DevTools.
 */
const PROMO_CODES: Record<string, number> = {
  ROCKET: 10,
  SELVA: 20,
};

export interface Player {
  id: string; // público: pode aparecer para outros jogadores
  token: string; // secreto: prova que "eu sou este jogador"
  name: string;
  balanceCents: number;
  /** Quando resgatou as fichas grátis pela última vez (0 = nunca). */
  lastBonusAt: number;
}

/** % de bônus de um código promocional, ou null se ele não existe. Não diferencia maiúsculas. */
export function promoBonusPercent(code: string): number | null {
  return PROMO_CODES[code.trim().toUpperCase()] ?? null;
}

function bonusWaitMs(player: Player): number {
  return Math.max(0, player.lastBonusAt + FREE_BONUS_COOLDOWN_MS - Date.now());
}

// Apelidos dos jogadores convidados: celebridades (só nomes de exibição, fichas de mentira).
const FAMOUS_NAMES = [
  "Neymar",
  "Marshall Mathers",
  "Johnny Depp",
  "MrBeast",
  "Anitta",
  "Ronaldinho",
  "Lionel Messi",
  "Cristiano Ronaldo",
  "Vini Jr.",
  "Keanu Reeves",
  "Snoop Dogg",
  "Rihanna",
  "Taylor Swift",
  "Drake",
  "Billie Eilish",
  "Gaules",
  "Casimiro",
  "Ludmilla",
  "Gisele Bündchen",
  "The Rock",
];

/** Sorteia um nome que ninguém conectado está usando; se todos estiverem em uso, acrescenta um número. */
function pickName(taken: Set<string>): string {
  const free = FAMOUS_NAMES.filter((name) => !taken.has(name));
  if (free.length > 0) return free[randomInt(free.length)]!;
  return `${FAMOUS_NAMES[randomInt(FAMOUS_NAMES.length)]!} ${randomInt(2, 100)}`;
}

/**
 * Guarda os jogadores EM MEMÓRIA (um Map). Se o servidor reiniciar, tudo some.
 * Num produto real seria um banco de dados; a interface (create/debit/credit)
 * continuaria igual, só a implementação mudaria.
 */
export class PlayerStore {
  private byToken = new Map<string, Player>();
  private byId = new Map<string, Player>(); // o jogo paga prêmios pelo id público

  create(): Player {
    const player: Player = {
      id: randomUUID(),
      token: randomUUID(),
      name: pickName(new Set([...this.byToken.values()].map((p) => p.name))),
      balanceCents: STARTING_BALANCE_CENTS,
      lastBonusAt: 0,
    };
    this.byToken.set(player.token, player);
    this.byId.set(player.id, player);
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

  /** Credita um prêmio. Chamado pelo jogo (cash-out manual OU automático). */
  creditById(playerId: string, cents: number): void {
    const player = this.byId.get(playerId);
    if (player) player.balanceCents += cents;
  }

  /** Recarga SIMULADA: só soma fichas virtuais (o valor já foi validado na rota). */
  deposit(player: Player, cents: number): void {
    player.balanceCents += cents;
  }

  /** Fichas grátis, com intervalo mínimo entre resgates controlado AQUI (não no cliente). */
  claimBonus(player: Player): void {
    const waitMs = bonusWaitMs(player);
    if (waitMs > 0) {
      // Arredonda o TOTAL de segundos antes de dividir (senão saía "4min 60s")
      const totalSeconds = Math.ceil(waitMs / 1000);
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      throw new AppError("BONUS_COOLDOWN", `Fichas grátis disponíveis de novo em ${minutes}min ${seconds}s.`);
    }
    player.balanceCents += FREE_BONUS_CENTS;
    player.lastBonusAt = Date.now();
  }
}

/** Converte para o formato público: o token NUNCA sai daqui por engano. */
export function toPlayerDTO(player: Player): PlayerDTO {
  return { id: player.id, name: player.name, balanceCents: player.balanceCents, nextBonusInMs: bonusWaitMs(player) };
}
