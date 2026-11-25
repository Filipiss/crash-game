import { useCallback, useEffect, useState } from "react";
import type { PlayerDTO } from "../../../shared/api.ts";
import { api, ApiError } from "../net/api.ts";

const TOKEN_KEY = "rocket-crash:token";

export interface Session {
  token: string;
  player: PlayerDTO;
}

/** Usa o token salvo se ele ainda vale; senão (ex.: servidor reiniciou) cria um jogador novo. */
async function loadOrCreate(): Promise<Session> {
  const saved = localStorage.getItem(TOKEN_KEY);
  if (saved) {
    try {
      return { token: saved, player: await api.me(saved) };
    } catch (err) {
      if (!(err instanceof ApiError && err.code === "UNAUTHORIZED")) throw err;
    }
  }
  const created = await api.createPlayer();
  localStorage.setItem(TOKEN_KEY, created.token);
  return created;
}

// Uma única promessa compartilhada enquanto o pedido está em andamento.
// Mesmo que o StrictMode rode o efeito 2x (ou duas partes do app peçam ao mesmo
// tempo), só UM jogador é criado.
let inflight: Promise<Session> | null = null;
function ensureSession(): Promise<Session> {
  inflight ??= loadOrCreate().finally(() => {
    inflight = null;
  });
  return inflight;
}

/** Quem é o jogador desta aba: token (localStorage) + dados públicos + saldo. */
export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Valida (ou recria) a sessão e atualiza o saldo vindo do servidor. */
  const refresh = useCallback(async () => {
    try {
      setSession(await ensureSession());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** As respostas de aposta/cash-out já trazem o saldo novo: só atualizamos localmente. */
  const setBalance = useCallback((balanceCents: number) => {
    setSession((s) => s && { ...s, player: { ...s.player, balanceCents } });
  }, []);

  const replacePlayer = useCallback((player: PlayerDTO) => {
    setSession((s) => s && { ...s, player });
  }, []);

  return { session, error, refresh, setBalance, replacePlayer };
}
