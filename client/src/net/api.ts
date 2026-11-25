import type {
  ApiErrorBody,
  BetRequest,
  BetResponse,
  CashoutResponse,
  CreatePlayerResponse,
  ErrorCode,
  PlayerDTO,
} from "../../../shared/api.ts";

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

async function request<T>(method: "GET" | "POST", path: string, options: { token?: string; body?: unknown } = {}): Promise<T> {
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
  refill: (token: string) => request<PlayerDTO>("POST", "/players/me/refill", { token }),
  bet: (token: string, amountCents: number) =>
    request<BetResponse>("POST", "/bet", { token, body: { amountCents } satisfies BetRequest }),
  cashout: (token: string) => request<CashoutResponse>("POST", "/cashout", { token }),
};
