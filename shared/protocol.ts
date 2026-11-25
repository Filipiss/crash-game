// Protocolo compartilhado: o "contrato" entre cliente e servidor.
// Os dois lados importam ESTE arquivo, então se um campo mudar aqui,
// o TypeScript acusa erro nos dois lados ao mesmo tempo.

/** As 3 fases de uma rodada, em ciclo: betting -> running -> crashed -> betting... */
export type RoundPhase = "betting" | "running" | "crashed";

/** Quantos crashes anteriores guardamos/mostramos. */
export const HISTORY_SIZE = 20;
/** Quantos ganhadores recentes guardamos/mostramos. */
export const WINNERS_SIZE = 10;

/** Uma aposta como TODOS os jogadores podem vê-la (sem nada secreto). */
export interface PublicBet {
  playerId: string;
  playerName: string;
  amountCents: number;
  /** Multiplicador em que saiu, ou null se ainda está "no foguete". */
  cashedOutAt: number | null;
}

/** Um cash-out que deu lucro, para a tabela "Ganhadores ao vivo". */
export interface Winner {
  roundId: number;
  playerId: string;
  playerName: string;
  amountCents: number;
  multiplier: number;
  payoutCents: number;
  /** Saiu sozinho pelo auto cash-out (true) ou clicando (false)? */
  auto: boolean;
  /** Horário do servidor (epoch ms). Só para exibir "às 14:32". */
  at: number;
}

/** Foto do estado atual da rodada (enviada para quem acabou de conectar). */
export interface RoundSnapshot {
  roundId: number;
  phase: RoundPhase;
  /** Fase "betting": quantos ms faltam para a rodada começar. */
  bettingMsLeft: number;
  /** Fase "running": quantos ms se passaram desde a decolagem. */
  elapsedMs: number;
  /** Só é preenchido depois do crash. Antes disso é segredo do servidor! */
  crashPoint: number | null;
}

/**
 * Mensagens que o servidor EMPURRA para o cliente via WebSocket.
 * É uma "discriminated union": o campo `type` diz qual formato a mensagem tem,
 * e o TypeScript estreita o tipo automaticamente dentro de um `switch (msg.type)`.
 */
export type ServerMessage =
  // Enviada UMA vez, logo ao conectar (ou reconectar): o estado completo.
  | { type: "snapshot"; round: RoundSnapshot; history: number[]; bets: PublicBet[]; winners: Winner[]; online: number }
  // A partir daí, só as MUDANÇAS (deltas):
  | { type: "betting"; roundId: number; durationMs: number }
  | { type: "running"; roundId: number }
  | { type: "tick"; roundId: number; elapsedMs: number; multiplier: number }
  | { type: "crashed"; roundId: number; crashPoint: number }
  | { type: "bet"; roundId: number; bet: PublicBet }
  | { type: "cashout"; roundId: number; win: Winner }
  | { type: "presence"; online: number };
