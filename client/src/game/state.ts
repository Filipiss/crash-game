import { multiplierAt } from "../../../shared/crash-math.ts";
import {
  HISTORY_SIZE,
  WINNERS_SIZE,
  type PublicBet,
  type RoundPhase,
  type ServerMessage,
  type Winner,
} from "../../../shared/protocol.ts";

/** Tudo que o cliente sabe sobre o jogo, montado a partir das mensagens do servidor. */
export interface GameState {
  roundId: number;
  phase: RoundPhase;
  /** Fase betting: instante (relógio LOCAL, em ms) em que as apostas fecham. */
  bettingEndsAt: number;
  /** Fase running: instante (relógio LOCAL) em que o foguete decolou. Base da interpolação. */
  runningSince: number;
  /** Último multiplicador confirmado pelo servidor. */
  multiplier: number;
  crashPoint: number | null;
  history: number[];
  bets: PublicBet[];
  /** Últimos cash-outs (de qualquer rodada), o mais novo primeiro. */
  winners: Winner[];
  /** Quantas pessoas estão com o jogo aberto agora. */
  online: number;
}

export const initialGameState: GameState = {
  roundId: 0,
  phase: "betting",
  bettingEndsAt: 0,
  runningSince: 0,
  multiplier: 1,
  crashPoint: null,
  history: [],
  bets: [],
  winners: [],
  online: 0,
};

/**
 * `receivedAt` é o relógio local no momento em que a mensagem chegou.
 * Ele vem DE FORA (em vez de chamar performance.now() aqui dentro) para que o
 * reducer seja uma função pura: mesma entrada -> mesma saída. Fácil de testar.
 */
export interface ServerAction {
  msg: ServerMessage;
  receivedAt: number;
}

/**
 * Reducer: (estado atual, mensagem) -> novo estado. Nunca altera o estado antigo,
 * sempre devolve um objeto novo (é assim que o React percebe que algo mudou).
 *
 * O `switch` cobre todos os tipos de ServerMessage. Se alguém adicionar uma
 * mensagem nova no protocolo e esquecer de tratar aqui, o TypeScript acusa erro.
 */
export function gameReducer(state: GameState, { msg, receivedAt }: ServerAction): GameState {
  switch (msg.type) {
    case "snapshot": {
      const { round } = msg;
      return {
        roundId: round.roundId,
        phase: round.phase,
        // Convertemos os tempos RELATIVOS do servidor para o relógio local.
        bettingEndsAt: receivedAt + round.bettingMsLeft,
        runningSince: receivedAt - round.elapsedMs,
        multiplier: round.crashPoint ?? (round.phase === "running" ? multiplierAt(round.elapsedMs) : 1),
        crashPoint: round.crashPoint,
        history: msg.history,
        bets: msg.bets,
        winners: msg.winners,
        online: msg.online,
      };
    }
    case "betting":
      return {
        ...state,
        roundId: msg.roundId,
        phase: "betting",
        bettingEndsAt: receivedAt + msg.durationMs,
        multiplier: 1,
        crashPoint: null,
        bets: [],
      };
    case "running":
      return { ...state, phase: "running", runningSince: receivedAt, multiplier: 1 };
    case "tick":
      // Cada tick "re-sincroniza" nosso relógio com o do servidor.
      return { ...state, multiplier: msg.multiplier, runningSince: receivedAt - msg.elapsedMs };
    case "crashed":
      return {
        ...state,
        phase: "crashed",
        multiplier: msg.crashPoint,
        crashPoint: msg.crashPoint,
        history: [msg.crashPoint, ...state.history].slice(0, HISTORY_SIZE),
      };
    case "bet":
      return { ...state, bets: [...state.bets, msg.bet] };
    case "cashout": {
      const { win } = msg;
      return {
        ...state,
        bets: state.bets.map((bet) => (bet.playerId === win.playerId ? { ...bet, cashedOutAt: win.multiplier } : bet)),
        winners: [win, ...state.winners].slice(0, WINNERS_SIZE),
      };
    }
    case "presence":
      return { ...state, online: msg.online };
  }
}
