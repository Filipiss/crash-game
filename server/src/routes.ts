import { Router, type ErrorRequestHandler, type Request } from "express";
import {
  FREE_BONUS_CENTS,
  MAX_AUTO_CASHOUT,
  MAX_BET_CENTS,
  MAX_DEPOSIT_CENTS,
  MIN_AUTO_CASHOUT,
  MIN_BET_CENTS,
  MIN_DEPOSIT_CENTS,
  PAYMENT_METHODS,
  type ApiErrorBody,
  type BetResponse,
  type BonusResponse,
  type CashoutResponse,
  type CreatePlayerResponse,
  type DepositRequest,
  type DepositResponse,
  type HistoryResponse,
  type PromoResponse,
} from "../../shared/api.ts";
import type { RoundSnapshot } from "../../shared/protocol.ts";
import { AppError, STATUS_BY_CODE } from "./errors.ts";
import type { CrashGame } from "./game.ts";
import { normalizeProfile, validateProfile, type UpdateProfileRequest } from "../../shared/profile.ts";
import { promoBonusPercent, toPlayerDTO, toProfileDTO, type Player, type PlayerStore } from "./players.ts";

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

  // Perfil completo (dados fictícios + estatísticas reais). Só o dono vê: exige o token.
  router.get("/players/me/profile", (req, res) => {
    res.json(toProfileDTO(requirePlayer(req)));
  });

  // PUT = "substitua os dados do perfil por estes". Mesma validação do formulário (shared/profile.ts).
  router.put("/players/me/profile", (req, res) => {
    const player = requirePlayer(req);
    const body = (req.body ?? {}) as Partial<Record<keyof UpdateProfileRequest, unknown>>;
    const input: UpdateProfileRequest = {
      fullName: typeof body.fullName === "string" ? body.fullName : "",
      email: typeof body.email === "string" ? body.email : "",
      phone: typeof body.phone === "string" ? body.phone : "",
      city: typeof body.city === "string" ? body.city : "",
    };
    const firstError = Object.values(validateProfile(input))[0];
    if (firstError) throw new AppError("INVALID_PROFILE", firstError);

    players.updateProfile(player, normalizeProfile(input));
    res.json(toProfileDTO(player));
  });

  // Fichas grátis (o intervalo entre resgates é controlado pelo servidor).
  router.post("/players/me/bonus", (req, res) => {
    const player = requirePlayer(req);
    players.claimBonus(player);
    const body: BonusResponse = { player: toPlayerDTO(player), bonusCents: FREE_BONUS_CENTS };
    res.json(body);
  });

  // Valida um código promocional ANTES de pagar (o botão "Ativar" do modal).
  router.get("/promo/:code", (req, res) => {
    const bonusPercent = promoBonusPercent(req.params.code);
    if (bonusPercent === null) throw new AppError("INVALID_PROMO", "Código promocional inválido.");
    const body: PromoResponse = { code: req.params.code.toUpperCase(), bonusPercent };
    res.json(body);
  });

  // Recarga SIMULADA de fichas virtuais. Nenhum dado de pagamento é recebido.
  router.post("/players/me/deposit", (req, res) => {
    const player = requirePlayer(req);
    const { amountCents, method, promoCode } = (req.body ?? {}) as Partial<Record<keyof DepositRequest, unknown>>;

    if (typeof amountCents !== "number" || !Number.isInteger(amountCents) || amountCents < MIN_DEPOSIT_CENTS || amountCents > MAX_DEPOSIT_CENTS) {
      throw new AppError("INVALID_DEPOSIT", `A recarga deve ficar entre ${MIN_DEPOSIT_CENTS} e ${MAX_DEPOSIT_CENTS} centavos.`);
    }
    if (typeof method !== "string" || !(PAYMENT_METHODS as readonly string[]).includes(method)) {
      throw new AppError("INVALID_PAYMENT_METHOD", "Forma de pagamento inválida.");
    }
    // O bônus do código é recalculado AQUI: o cliente não manda "quanto de bônus quer".
    let bonusPercent = 0;
    if (typeof promoCode === "string" && promoCode.trim() !== "") {
      const percent = promoBonusPercent(promoCode);
      if (percent === null) throw new AppError("INVALID_PROMO", "Código promocional inválido.");
      bonusPercent = percent;
    }
    const bonusCents = Math.floor((amountCents * bonusPercent) / 100);
    players.deposit(player, amountCents + bonusCents);

    const body: DepositResponse = { player: toPlayerDTO(player), depositedCents: amountCents, bonusCents };
    res.status(201).json(body);
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
    players.recordBet(player, amountCents); // estatísticas do perfil

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

  // Qualquer /api/... que não casou com nada acima: 404 em JSON (no formato padrão de
  // erro), em vez da página HTML que o Express devolveria e o cliente não saberia ler.
  router.use(() => {
    throw new AppError("NOT_FOUND", "Rota da API não encontrada.");
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
