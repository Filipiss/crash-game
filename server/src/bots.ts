import { randomInt, randomUUID } from "node:crypto";
import type { CrashGame } from "./game.ts";

/**
 * JOGADORES SIMULADOS (bots), para a sala parecer movimentada na demo.
 *
 * Eles não têm atalho nenhum: apostam pelo MESMO game.placeBet() de um jogador
 * de verdade, respeitam a janela de apostas e saem pelo auto cash-out do
 * servidor. Então tudo que aparece (ganhadores, banca, avatares) é consistente
 * para todos os clientes, e as regras do jogo continuam sendo testadas.
 *
 * Os prêmios deles caem no vazio: não existem na carteira (PlayerStore).
 */

// Nomes diferentes dos usados pelos jogadores humanos, para não repetir na mesma sala.
const BOT_NAMES = [
  "Lady Gaga",
  "Shakira",
  "Usain Bolt",
  "Zendaya",
  "Bad Bunny",
  "Ed Sheeran",
  "Kylian Mbappé",
  "LeBron James",
  "Dua Lipa",
  "Pedro Pascal",
  "Selena Gomez",
  "Post Malone",
  "Ronaldo Fenômeno",
  "Felipe Neto",
  "Whindersson Nunes",
  "Ivete Sangalo",
  "Luva de Pedreiro",
  "Bruna Marquezine",
];

const AMOUNTS_CENTS = [500, 1_000, 1_000, 2_000, 2_500, 5_000, 5_000, 10_000, 20_000, 50_000];
// Alvos de saída: a maioria conservadora, alguns ousados. null = "esqueceu de sair" (perde).
const AUTO_TARGETS: (number | null)[] = [1.2, 1.3, 1.5, 1.5, 1.8, 2, 2, 2.5, 3, 4, 5, 10, null];

const pick = <T>(list: readonly T[]): T => list[randomInt(list.length)]!;

function shuffle<T>(list: readonly T[]): T[] {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

export class BotCrowd {
  private readonly game: CrashGame;
  private readonly bots = BOT_NAMES.map((name) => ({ id: `bot-${randomUUID()}`, name }));
  private readonly ids = new Set(this.bots.map((bot) => bot.id));
  private online = 0;

  constructor(game: CrashGame) {
    this.game = game;
  }

  /** Começa a ouvir o jogo: a cada rodada nova, alguns bots apostam. */
  start(): void {
    this.game.onEvent((msg) => {
      if (msg.type === "betting") this.onBettingOpen(msg.durationMs);
    });
  }

  isBot(playerId: string): boolean {
    return this.ids.has(playerId);
  }

  /** Quantos jogadores simulados estão "online" agora (soma no contador da sala). */
  onlineCount(): number {
    return this.online;
  }

  private onBettingOpen(windowMs: number): void {
    // A sala "respira": muda um pouco a cada rodada.
    this.online = randomInt(10, this.bots.length + 1);
    const players = shuffle(this.bots).slice(0, randomInt(4, 11));

    for (const bot of players) {
      // Cada um aposta num momento diferente da janela: as apostas "pingam" na tela.
      const delay = randomInt(300, Math.max(400, windowMs - 300));
      setTimeout(() => {
        try {
          this.game.placeBet(bot.id, bot.name, pick(AMOUNTS_CENTS), pick(AUTO_TARGETS));
        } catch {
          // Janela fechou antes (ex.: timer atrasado): o bot simplesmente fica de fora.
        }
      }, delay);
    }
  }
}
