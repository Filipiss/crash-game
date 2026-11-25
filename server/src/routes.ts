import { Router, type ErrorRequestHandler, type Request } from "express";
import {
  MAX_AUTO_CASHOUT,
  MAX_BET_CENTS,
  MIN_AUTO_CASHOUT,
  MIN_BET_CENTS,
  type ApiErrorBody,
  type BetResponse,
  type CashoutResponse,
  type CreatePlayerResponse,
  type HistoryResponse,
} from "../../shared/api.ts";
import type { RoundSnapshot } from "../../shared/protocol.ts";
import { AppError, STATUS_BY_CODE } from "./errors.ts";
import type { CrashGame } from "./game.ts";
import { toPlayerDTO, type Player, type PlayerStore } from "./players.ts";

/**
 * Camada HTTP: traduz pedidos em chamadas ao jogo/carteira e respostas em JSON.
 * Regra de negócio NÃO mora aqui (mora em game.ts e players.ts).
 */
export function createApiRouter(game: CrashGame, players: PlayerStore): Router {
  const router = Router();

  /** Identifica o jogador pelo header "Authorization: Bearer <token>". */
  function requirePlayer(req: Request): Player {
    const header = req.get("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
    const player = players.findByToken(token);
    if (!player) {
      throw new AppError("UNAUTHORIZED", "Sessão inválida. Crie um jogador com POST /api/players.");
    }
    return player;
  }

  /** Nunca confie no corpo do pedido: valide tipo, inteiro e limites. */
  function parseAmount(req: Request): number {
    const amount = (req.body as { amountCents?: unknown } | undefined)?.amountCents;
    if (typeof amount !== "number" || !Number.isInteger(amount)) {
      throw new AppError("INVALID_AMOUNT", "amountCents deve ser um número inteiro de centavos.");
    }
    if (amount < MIN_BET_CENTS || amount > MAX_BET_CENTS) {
      throw new AppError("INVALID_AMOUNT", `A aposta deve ficar entre ${MIN_BET_CENTS} e ${MAX_BET_CENTS} centavos.`);
    }
    return amount;
  }

  /** Alvo de auto cash-out: opcional; se vier, precisa ser um multiplicador válido. */
  function parseAutoCashout(req: Request): number | null {
    const value = (req.body as { autoCashoutAt?: unknown } | undefined)?.autoCashoutAt;
    if (value === undefined || value === null) return null;
    if (typeof value !== "number" || !Number.isFinite(value) || value < MIN_AUTO_CASHOUT || value > MAX_AUTO_CASHOUT) {
      throw new AppError("INVALID_AUTO_CASHOUT", `O auto cash-out deve ficar entre ${MIN_AUTO_CASHOUT}x e ${MAX_AUTO_CASHOUT}x.`);
    }
    return Math.floor(value * 100) / 100; // 2 casas, para baixo (mesma regra do resto)
  }

  router.get("/health", (_req, res) => {
    res.json({ ok: true, time: Date.now() });
  });

  // Cria um jogador convidado (201 Created = "criei um recurso novo").
  router.post("/players", (_req, res) => {
    const player = players.create();
    const body: CreatePlayerResponse = { token: player.token, player: toPlayerDTO(player) };
    res.status(201).json(body);
  });

  router.get("/players/me", (req, res) => {
    res.json(toPlayerDTO(requirePlayer(req)));
  });

  router.post("/players/me/refill", (req, res) => {
    const player = requirePlayer(req);
    // Sem essa checagem dava para apostar tudo, recarregar durante o voo e ainda ganhar a aposta.
    if (player.balanceCents >= MIN_BET_CENTS || game.hasOpenBet(player.id)) {
      throw new AppError("REFILL_NOT_ALLOWED", "Só dá para recarregar quando o saldo acabar e não houver aposta em jogo.");
    }
    players.refill(player);
    res.json(toPlayerDTO(player));
  });

  router.get("/round", (_req, res) => {
    const body: RoundSnapshot = game.getSnapshot();
    res.json(body);
  });

  router.get("/history", (_req, res) => {
    const body: HistoryResponse = { history: game.getHistory() };
    res.json(body);
  });

  router.post("/bet", (req, res) => {
    const player = requirePlayer(req);
    const amountCents = parseAmount(req);
    const autoCashoutAt = parseAutoCashout(req);
    if (amountCents > player.balanceCents) {
      throw new AppError("INSUFFICIENT_FUNDS", "Saldo insuficiente.");
    }
    // Ordem importa: primeiro o jogo aceita (pode lançar erro), só então debitamos.
    // Não há nenhum "await" entre checar e debitar, então nenhum outro pedido
    // consegue se intrometer no meio (o JavaScript roda uma coisa por vez).
    const roundId = game.placeBet(player.id, player.name, amountCents, autoCashoutAt);
    players.debit(player, amountCents);

    const body: BetResponse = { roundId, amountCents, autoCashoutAt, balanceCents: player.balanceCents };
    res.status(201).json(body);
  });

  router.post("/cashout", (req, res) => {
    const player = requirePlayer(req);
    // O jogo calcula E paga (via players.creditById): aqui só lemos o saldo novo.
    const { multiplier, payoutCents } = game.cashOut(player.id);

    const body: CashoutResponse = { multiplier, payoutCents, balanceCents: player.balanceCents };
    res.json(body);
  });

  return router;
}

/**
 * Middleware de erro: qualquer erro lançado numa rota cai aqui.
 * (No Express 5 isso vale até para funções async.)
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  let body: ApiErrorBody;
  let status: number;

  if (err instanceof AppError) {
    status = STATUS_BY_CODE[err.code];
    body = { error: { code: err.code, message: err.message } };
  } else if ((err as { type?: string }).type === "entity.parse.failed") {
    // O express.json() não conseguiu ler o corpo (JSON inválido).
    status = 400;
    body = { error: { code: "INVALID_BODY", message: "Corpo da requisição não é um JSON válido." } };
  } else {
    // Bug de verdade: loga tudo no servidor, mas não vaza detalhes para o cliente.
    console.error(err);
    status = 500;
    body = { error: { code: "INTERNAL", message: "Erro inesperado no servidor." } };
  }
  res.status(status).json(body);
};
