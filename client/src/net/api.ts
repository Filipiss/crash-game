import type {
  ApiErrorBody,
  BetRequest,
  BetResponse,
  BonusResponse,
  CashoutResponse,
  CreatePlayerResponse,
  DepositRequest,
  DepositResponse,
  ErrorCode,
  PlayerDTO,
  PromoResponse,
} from "../../../shared/api.ts";
import type { ProfileDTO, UpdateProfileRequest } from "../../../shared/profile.ts";

/** Erro da API com o `code` do servidor (ou NETWORK, quando nem chegou lá). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode | "NETWORK";

  constructor(status: number, code: ErrorCode | "NETWORK", message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(method: "GET" | "POST" | "PUT", path: string, options: { token?: string; body?: unknown } = {}): Promise<T> {
  const { token, body } = options;
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: {
        ...(body !== undefined && { "Content-Type": "application/json" }),
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    // fetch só "lança" quando a requisição nem chegou ao servidor (sem internet, servidor fora)
    throw new ApiError(0, "NETWORK", "Sem conexão com o servidor.");
  }

  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const error = (json as ApiErrorBody | null)?.error;
    throw new ApiError(res.status, error?.code ?? "INTERNAL", error?.message ?? `Erro HTTP ${res.status}`);
  }
  return json as T;
}

/** Todas as chamadas REST do jogo, tipadas pelo contrato em shared/api.ts. */
export const api = {
  createPlayer: () => request<CreatePlayerResponse>("POST", "/players"),
  me: (token: string) => request<PlayerDTO>("GET", "/players/me", { token }),
  getProfile: (token: string) => request<ProfileDTO>("GET", "/players/me/profile", { token }),
  updateProfile: (token: string, body: UpdateProfileRequest) => request<ProfileDTO>("PUT", "/players/me/profile", { token, body }),
  claimBonus: (token: string) => request<BonusResponse>("POST", "/players/me/bonus", { token }),
  checkPromo: (code: string) => request<PromoResponse>("GET", `/promo/${encodeURIComponent(code)}`),
  /** Recarga SIMULADA: o servidor só credita fichas virtuais. */
  deposit: (token: string, body: DepositRequest) => request<DepositResponse>("POST", "/players/me/deposit", { token, body }),
  bet: (token: string, amountCents: number, autoCashoutAt: number | null) =>
    request<BetResponse>("POST", "/bet", { token, body: { amountCents, autoCashoutAt } satisfies BetRequest }),
  cashout: (token: string) => request<CashoutResponse>("POST", "/cashout", { token }),
};
