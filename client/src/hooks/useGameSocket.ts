import { useEffect, useReducer, useState } from "react";
import { gameReducer, initialGameState } from "../game/state.ts";
import { GameSocket, type ConnectionStatus } from "../net/GameSocket.ts";

/** Conecta no WebSocket e mantém o GameState atualizado com cada mensagem do servidor. */
export function useGameSocket() {
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [game, dispatch] = useReducer(gameReducer, initialGameState);

  useEffect(() => {
    const socket = new GameSocket();
    const offStatus = socket.onStatus(setStatus);
    const offMessage = socket.onMessage((msg) => dispatch({ msg, receivedAt: performance.now() }));
    socket.connect();
    // Limpeza: sem ela, cada montagem deixaria uma conexão "fantasma" aberta.
    return () => {
      offStatus();
      offMessage();
      socket.close();
    };
  }, []);

  return { game, status };
}
