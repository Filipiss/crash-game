import { useCallback, useEffect, useState } from "react";
import type { PlayerDTO } from "../../../shared/api.ts";
import { api, ApiError } from "../net/api.ts";

const TOKEN_KEY = "rocket-crash:token";

export interface Session {
  token: string;
  player: PlayerDTO;
  /** Instante (relógio LOCAL, performance.now) em que as fichas grátis liberam. */
  bonusReadyAt: number;
}

/** O servidor diz "faltam X ms"; convertemos para o relógio local no momento em que chegou. */
function withBonusClock(token: string, player: PlayerDTO): Session {
  return { token, player, bonusReadyAt: performance.now() + player.nextBonusInMs };
}

/** Usa o token salvo se ele ainda vale; senão (ex.: servidor reiniciou) cria um jogador novo. */
async function loadOrCreate(): Promise<Session> {
  const saved = localStorage.getItem(TOKEN_KEY);
  if (saved) {
    try {
      return withBonusClock(saved, await api.me(saved));
    } catch (err) {
      if (!(err instanceof ApiError && err.code === "UNAUTHORIZED")) throw err;
    }
  }
  const created = await api.createPlayer();
  localStorage.setItem(TOKEN_KEY, created.token);
  return withBonusClock(created.token, created.player);
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

  /** Respostas de bônus/recarga trazem o jogador inteiro (saldo + tempo do próximo bônus). */
  const replacePlayer = useCallback((player: PlayerDTO) => {
    setSession((s) => s && withBonusClock(s.token, player));
  }, []);

  return { session, error, refresh, setBalance, replacePlayer };
}
