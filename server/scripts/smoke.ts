// Teste de fumaça da REST API: joga uma rodada inteira de verdade contra o servidor rodando.
// Rodar (com `npm run dev` ligado em outro terminal): npm run smoke -w server
import type {
  ApiErrorBody,
  BetResponse,
  BonusResponse,
  CashoutResponse,
  CreatePlayerResponse,
  DepositResponse,
  HistoryResponse,
  PlayerDTO,
  PromoResponse,
} from "../../shared/api.ts";
import { msToReach } from "../../shared/crash-math.ts";
import type { RoundSnapshot } from "../../shared/protocol.ts";

const BASE = process.env.API_URL ?? "http://localhost:3001/api";
const TARGET = 1.3; // vamos tentar sair em 1.30x

class ApiError extends Error {
  constructor(readonly status: number, readonly body: ApiErrorBody) {
    super(`${status} ${body.error.code}: ${body.error.message}`);
  }
}

async function api<T>(method: string, path: string, token?: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body !== undefined && { "Content-Type": "application/json" }),
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json: unknown = await res.json();
  if (!res.ok) throw new ApiError(res.status, json as ApiErrorBody);
  return json as T;
}

/** Espera um erro específico: prova que a validação funciona. */
async function expectError(label: string, code: string, call: () => Promise<unknown>) {
  try {
    await call();
    console.log(`✗ ${label}: deveria ter falhado com ${code}`);
    process.exitCode = 1;
  } catch (err) {
    const ok = err instanceof ApiError && err.body.error.code === code;
    console.log(`${ok ? "✓" : "✗"} ${label}: ${(err as Error).message}`);
    if (!ok) process.exitCode = 1;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(predicate: (r: RoundSnapshot) => boolean): Promise<RoundSnapshot> {
  for (;;) {
    const round = await api<RoundSnapshot>("GET", "/round");
    if (predicate(round)) return round;
    await sleep(50);
  }
}

const { token, player } = await api<CreatePlayerResponse>("POST", "/players");
console.log(`✓ jogador criado: ${player.name}, saldo ${player.balanceCents} centavos`);

await expectError("sem token", "UNAUTHORIZED", () => api("POST", "/bet", undefined, { amountCents: 1000 }));
await expectError("valor quebrado", "INVALID_AMOUNT", () => api("POST", "/bet", token, { amountCents: 10.5 }));

// Carteira virtual: fichas grátis, código promocional e recarga SIMULADA
const bonus = await api<BonusResponse>("POST", "/players/me/bonus", token);
console.log(`✓ fichas grátis: +${bonus.bonusCents}, saldo ${bonus.player.balanceCents}, próximo resgate em ${Math.round(bonus.player.nextBonusInMs / 1000)}s`);
await expectError("resgatar 2x seguidas", "BONUS_COOLDOWN", () => api("POST", "/players/me/bonus", token));
await expectError("código inexistente", "INVALID_PROMO", () => api("GET", "/promo/NAOEXISTE"));
const promo = await api<PromoResponse>("GET", "/promo/rocket");
const deposit = await api<DepositResponse>("POST", "/players/me/deposit", token, { amountCents: 3000, method: "pix", promoCode: "rocket" });
const depositOk = deposit.bonusCents === Math.floor((3000 * promo.bonusPercent) / 100);
if (!depositOk) process.exitCode = 1;
console.log(`${depositOk ? "✓" : "✗"} recarga de 3000 com ${promo.code} (+${promo.bonusPercent}%): bônus ${deposit.bonusCents}, saldo ${deposit.player.balanceCents}`);
await expectError("pagar com skins", "INVALID_PAYMENT_METHOD", () =>
  api("POST", "/players/me/deposit", token, { amountCents: 3000, method: "skins" }),
);
await expectError("recarga abaixo do mínimo", "INVALID_DEPOSIT", () =>
  api("POST", "/players/me/deposit", token, { amountCents: 50, method: "pix" }),
);

const round = await waitFor((r) => r.phase === "betting" && r.bettingMsLeft > 1000);
console.log(`✓ rodada ${round.roundId} aceitando apostas (${round.bettingMsLeft}ms restantes)`);

const bet = await api<BetResponse>("POST", "/bet", token, { amountCents: 1000 });
console.log(`✓ apostou ${bet.amountCents} centavos, saldo agora ${bet.balanceCents}`);

await expectError("apostar 2x", "ALREADY_BET", () => api("POST", "/bet", token, { amountCents: 1000 }));
await expectError("cash-out antes de decolar", "ROUND_NOT_RUNNING", () => api("POST", "/cashout", token));

const final = await waitFor((r) => r.phase === "crashed" || (r.phase === "running" && r.elapsedMs >= msToReach(TARGET)));
if (final.phase === "crashed") {
  console.log(`✓ crashou em ${final.crashPoint}x antes de ${TARGET}x: perdemos a aposta (faz parte!)`);
} else {
  const cash = await api<CashoutResponse>("POST", "/cashout", token);
  console.log(`✓ cash-out em ${cash.multiplier}x: recebeu ${cash.payoutCents} centavos, saldo ${cash.balanceCents}`);
  await expectError("cash-out 2x", "ALREADY_CASHED_OUT", () => api("POST", "/cashout", token));
}

await waitFor((r) => r.phase === "crashed");
const me = await api<PlayerDTO>("GET", "/players/me", token);
const { history } = await api<HistoryResponse>("GET", "/history");
console.log(`✓ saldo final: ${me.balanceCents} centavos`);
console.log(`✓ histórico: ${history.map((m) => m.toFixed(2) + "x").join("  ")}`);

// Auto cash-out: o SERVIDOR sai sozinho, exatamente no alvo, sem nenhum pedido do cliente.
const AUTO = 1.2;
await expectError("auto cash-out inválido", "INVALID_AUTO_CASHOUT", () =>
  api("POST", "/bet", token, { amountCents: 1000, autoCashoutAt: 0.5 }),
);
await waitFor((r) => r.phase === "betting" && r.bettingMsLeft > 1000);
const autoBet = await api<BetResponse>("POST", "/bet", token, { amountCents: 1000, autoCashoutAt: AUTO });
const ended = await waitFor((r) => r.phase === "crashed");
const afterAuto = (await api<PlayerDTO>("GET", "/players/me", token)).balanceCents;
const reached = ended.crashPoint! >= AUTO;
const expected = autoBet.balanceCents + (reached ? Math.floor(1000 * AUTO) : 0);
const autoOk = afterAuto === expected;
if (!autoOk) process.exitCode = 1;
console.log(
  `${autoOk ? "✓" : "✗"} auto cash-out em ${AUTO}x com crash em ${ended.crashPoint}x: ` +
    `${reached ? "pagou sozinho" : "não chegou no alvo"}, saldo ${afterAuto} (esperado ${expected})`,
);
