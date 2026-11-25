import {
  HISTORY_SIZE,
  WINNERS_SIZE,
  type PublicBet,
  type RoundPhase,
  type RoundSnapshot,
  type ServerMessage,
  type Winner,
} from "../../shared/protocol.ts";
import { floorMultiplier, multiplierAt, msToReach } from "../../shared/crash-math.ts";
import { generateCrashPoint } from "./crash-point.ts";
import { AppError } from "./errors.ts";

const BETTING_MS = 5_000; // janela para apostar
const CRASHED_PAUSE_MS = 3_000; // pausa mostrando o resultado
const TICK_MS = 100; // 10 atualizações por segundo pela rede

type Listener = (msg: ServerMessage) => void;
/** Quem paga o prêmio (a carteira). O jogo decide QUANTO; a carteira só credita. */
type PayoutFn = (playerId: string, payoutCents: number) => void;

/** A aposta como o SERVIDOR a guarda: o alvo de auto cash-out não é público. */
interface Bet extends PublicBet {
  autoCashoutAt: number | null;
}

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
  private winners: Winner[] = [];
  private tickTimer: NodeJS.Timeout | null = null;
  private autoTimers: NodeJS.Timeout[] = [];
  private listeners = new Set<Listener>();
  /** Apostas da rodada atual, uma por jogador. */
  private bets = new Map<string, Bet>();
  private readonly payout: PayoutFn;

  constructor(payout: PayoutFn) {
    this.payout = payout;
  }

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

  getWinners(): Winner[] {
    return this.winners.map((win) => ({ ...win }));
  }

  /** Cópias PÚBLICAS das apostas: sem o alvo de auto cash-out de ninguém. */
  getBets(): PublicBet[] {
    return [...this.bets.values()].map(toPublic);
  }

  /** Registra uma aposta. Só é permitido durante a fase "betting". */
  placeBet(playerId: string, playerName: string, amountCents: number, autoCashoutAt: number | null): number {
    if (this.phase !== "betting") {
      throw new AppError("BETTING_CLOSED", "As apostas desta rodada já fecharam. Aguarde a próxima.");
    }
    if (this.bets.has(playerId)) {
      throw new AppError("ALREADY_BET", "Você já apostou nesta rodada.");
    }
    const bet: Bet = { playerId, playerName, amountCents, cashedOutAt: null, autoCashoutAt };
    this.bets.set(playerId, bet);
    this.emit({ type: "bet", roundId: this.roundId, bet: toPublic(bet) });
    return this.roundId;
  }

  /**
   * Cash-out MANUAL: no multiplicador atual, calculado pelo relógio do servidor.
   * O cliente não diz "saí em 2.5x": ele só pede para sair, e o servidor decide quanto vale.
   */
  cashOut(playerId: string): Winner {
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
    return this.settle(bet, multiplier, false);
  }

  /**
   * ÚNICO lugar onde um prêmio é pago (manual ou automático).
   * Um caminho só = impossível pagar duas vezes ou com regras diferentes.
   */
  private settle(bet: Bet, multiplier: number, auto: boolean): Winner {
    bet.cashedOutAt = multiplier;
    // Centavos inteiros, arredondando para baixo (a favor da casa, nunca do bug).
    const payoutCents = Math.floor(bet.amountCents * multiplier);
    this.payout(bet.playerId, payoutCents);

    const win: Winner = {
      roundId: this.roundId,
      playerId: bet.playerId,
      playerName: bet.playerName,
      amountCents: bet.amountCents,
      multiplier,
      payoutCents,
      auto,
      at: Date.now(),
    };
    this.winners = [win, ...this.winners].slice(0, WINNERS_SIZE);
    this.emit({ type: "cashout", roundId: this.roundId, win: { ...win } });
    return win;
  }

  /** Auto cash-out: paga EXATAMENTE o alvo, sem depender de latência de rede. */
  private autoCashOut(bet: Bet): void {
    if (this.phase !== "running" || bet.cashedOutAt !== null || bet.autoCashoutAt === null) return;
    this.settle(bet, bet.autoCashoutAt, true);
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

    // Como a curva é uma fórmula, sabemos exatamente QUANDO cada alvo será atingido:
    // agendamos um timer por aposta automática (só as que vão chegar antes do crash).
    for (const bet of this.bets.values()) {
      if (bet.autoCashoutAt !== null && bet.autoCashoutAt <= this.crashPoint) {
        this.autoTimers.push(setTimeout(() => this.autoCashOut(bet), msToReach(bet.autoCashoutAt)));
      }
    }

    // Idem para o crash: um único setTimeout, sem "checar a cada tick".
    setTimeout(() => this.crash(), msToReach(this.crashPoint));
  }

  private crash(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = null;

    // Se um alvo automático e o crash caírem no MESMO milissegundo, a ordem dos timers
    // não é garantida. Pagamos antes quem tinha direito (alvo <= crashPoint).
    for (const bet of this.bets.values()) {
      if (bet.autoCashoutAt !== null && bet.autoCashoutAt <= this.crashPoint) this.autoCashOut(bet);
    }
    for (const timer of this.autoTimers) clearTimeout(timer);
    this.autoTimers = [];

    this.phase = "crashed";
    this.phaseStartedAt = Date.now();
    this.history = [this.crashPoint, ...this.history].slice(0, HISTORY_SIZE);

    this.emit({ type: "crashed", roundId: this.roundId, crashPoint: this.crashPoint });
    setTimeout(() => this.startBetting(), CRASHED_PAUSE_MS);
  }
}

function toPublic(bet: Bet): PublicBet {
  return { playerId: bet.playerId, playerName: bet.playerName, amountCents: bet.amountCents, cashedOutAt: bet.cashedOutAt };
}
