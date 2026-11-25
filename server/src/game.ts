import { HISTORY_SIZE, type PublicBet, type RoundPhase, type RoundSnapshot, type ServerMessage } from "../../shared/protocol.ts";
import { floorMultiplier, multiplierAt, msToReach } from "../../shared/crash-math.ts";
import { generateCrashPoint } from "./crash-point.ts";
import { AppError } from "./errors.ts";

const BETTING_MS = 5_000; // janela para apostar
const CRASHED_PAUSE_MS = 3_000; // pausa mostrando o resultado
const TICK_MS = 100; // 10 atualizações por segundo pela rede

type Listener = (msg: ServerMessage) => void;

/**
 * O loop do jogo. É uma máquina de estados com 3 fases que se repetem:
 *
 *   betting (5s) ──► running (até o crash) ──► crashed (3s) ──┐
 *       ▲                                                     │
 *       └─────────────────────────────────────────────────────┘
 *
 * Não sabe nada de HTTP nem WebSocket: só emite eventos.
 * Quem quiser (o WebSocket, um log, um teste) se inscreve com onEvent().
 */
export class CrashGame {
  private roundId = 0;
  private phase: RoundPhase = "crashed";
  private phaseStartedAt = 0;
  private crashPoint = 1;
  private history: number[] = [];
  private tickTimer: NodeJS.Timeout | null = null;
  private listeners = new Set<Listener>();
  /** Apostas da rodada atual, uma por jogador. */
  private bets = new Map<string, PublicBet>();

  start(): void {
    this.startBetting();
  }

  /** Inscreve um ouvinte. Retorna a função que cancela a inscrição. */
  onEvent(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): RoundSnapshot {
    const sincePhaseStart = Date.now() - this.phaseStartedAt;
    return {
      roundId: this.roundId,
      phase: this.phase,
      bettingMsLeft: this.phase === "betting" ? Math.max(0, BETTING_MS - sincePhaseStart) : 0,
      elapsedMs: this.phase === "running" ? sincePhaseStart : 0,
      // Regra de ouro: o crashPoint só sai do servidor depois do crash.
      crashPoint: this.phase === "crashed" ? this.crashPoint : null,
    };
  }

  getHistory(): number[] {
    return [...this.history];
  }

  /** Cópias das apostas: quem chama não consegue alterar o estado interno por acidente. */
  getBets(): PublicBet[] {
    return [...this.bets.values()].map((bet) => ({ ...bet }));
  }

  /** O jogador ainda tem dinheiro "no foguete" (apostou e não saiu, rodada não acabou)? */
  hasOpenBet(playerId: string): boolean {
    const bet = this.bets.get(playerId);
    return bet !== undefined && bet.cashedOutAt === null && this.phase !== "crashed";
  }

  /** Registra uma aposta. Só é permitido durante a fase "betting". */
  placeBet(playerId: string, playerName: string, amountCents: number): number {
    if (this.phase !== "betting") {
      throw new AppError("BETTING_CLOSED", "As apostas desta rodada já fecharam. Aguarde a próxima.");
    }
    if (this.bets.has(playerId)) {
      throw new AppError("ALREADY_BET", "Você já apostou nesta rodada.");
    }
    const bet: PublicBet = { playerId, playerName, amountCents, cashedOutAt: null };
    this.bets.set(playerId, bet);
    this.emit({ type: "bet", roundId: this.roundId, bet: { ...bet } });
    return this.roundId;
  }

  /**
   * Tira o jogador do foguete no multiplicador ATUAL, calculado pelo relógio do servidor.
   * O cliente não diz "saí em 2.5x": ele só pede para sair, e o servidor decide quanto vale.
   */
  cashOut(playerId: string): { multiplier: number; payoutCents: number } {
    const bet = this.bets.get(playerId);
    if (!bet) {
      throw new AppError("NO_ACTIVE_BET", "Você não tem aposta nesta rodada.");
    }
    if (this.phase !== "running") {
      throw new AppError("ROUND_NOT_RUNNING", "A rodada não está em andamento.");
    }
    if (bet.cashedOutAt !== null) {
      throw new AppError("ALREADY_CASHED_OUT", "Você já saiu desta rodada.");
    }

    const multiplier = floorMultiplier(multiplierAt(Date.now() - this.phaseStartedAt));
    // O setTimeout do crash pode disparar alguns ms atrasado. A fonte da verdade
    // é o crashPoint sorteado, não o timer: passou dele, perdeu.
    if (multiplier > this.crashPoint) {
      throw new AppError("TOO_LATE", "Tarde demais: o foguete já explodiu.");
    }

    bet.cashedOutAt = multiplier;
    // Centavos inteiros, arredondando para baixo (a favor da casa, nunca do bug).
    const payoutCents = Math.floor(bet.amountCents * multiplier);
    this.emit({ type: "cashout", roundId: this.roundId, playerId, multiplier, payoutCents });
    return { multiplier, payoutCents };
  }

  private emit(msg: ServerMessage): void {
    for (const listener of this.listeners) listener(msg);
  }

  private startBetting(): void {
    this.roundId++;
    this.phase = "betting";
    this.phaseStartedAt = Date.now();
    this.bets.clear(); // apostas não cobertas da rodada anterior já foram perdidas
    // Sorteado já agora (antes das apostas) e guardado em segredo.
    this.crashPoint = generateCrashPoint();

    this.emit({ type: "betting", roundId: this.roundId, durationMs: BETTING_MS });
    setTimeout(() => this.startRunning(), BETTING_MS);
  }

  private startRunning(): void {
    this.phase = "running";
    this.phaseStartedAt = Date.now();
    this.emit({ type: "running", roundId: this.roundId });

    this.tickTimer = setInterval(() => {
      const elapsedMs = Date.now() - this.phaseStartedAt;
      this.emit({
        type: "tick",
        roundId: this.roundId,
        elapsedMs,
        multiplier: Math.min(multiplierAt(elapsedMs), this.crashPoint),
      });
    }, TICK_MS);

    // Não precisamos "checar a cada tick se passou do crash":
    // como a curva é uma fórmula, sabemos exatamente QUANDO ela chega no crashPoint.
    setTimeout(() => this.crash(), msToReach(this.crashPoint));
  }

  private crash(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = null;

    this.phase = "crashed";
    this.phaseStartedAt = Date.now();
    this.history = [this.crashPoint, ...this.history].slice(0, HISTORY_SIZE);

    this.emit({ type: "crashed", roundId: this.roundId, crashPoint: this.crashPoint });
    setTimeout(() => this.startBetting(), CRASHED_PAUSE_MS);
  }
}
