import type { Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import type { ServerMessage } from "../../shared/protocol.ts";
import type { CrashGame } from "./game.ts";

const HEARTBEAT_MS = 30_000;
/** Se um cliente tem mais que isso "entalado" para enviar, ele está lento. */
const MAX_BUFFERED_BYTES = 64 * 1024;

function send(ws: WebSocket, msg: ServerMessage): void {
  ws.send(JSON.stringify(msg));
}

/**
 * Liga o WebSocket ao servidor HTTP existente (mesma porta, caminho /ws).
 *
 * O fluxo é SÓ servidor -> cliente. Ações do jogador (apostar, sair) continuam
 * via REST, que tem resposta, status HTTP e é fácil de testar. O WebSocket é o
 * "alto-falante" que avisa todo mundo do que aconteceu.
 */
export function attachRealtime(httpServer: Server, game: CrashGame): void {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
  const alive = new WeakMap<WebSocket, boolean>();

  wss.on("connection", (ws) => {
    alive.set(ws, true);
    ws.on("pong", () => alive.set(ws, true));
    ws.on("close", () => console.log(`[ws] cliente saiu (${wss.clients.size} conectados)`));
    console.log(`[ws] cliente entrou (${wss.clients.size} conectados)`);

    // Padrão "snapshot + deltas": quem chega (ou reconecta) recebe o estado
    // COMPLETO uma vez; depois disso, só as mudanças.
    send(ws, {
      type: "snapshot",
      round: game.getSnapshot(),
      history: game.getHistory(),
      bets: game.getBets(),
    });
  });

  // Broadcast: todo evento do jogo vai para todos os clientes conectados.
  game.onEvent((msg) => {
    const data = JSON.stringify(msg); // serializa UMA vez, não uma por cliente
    for (const ws of wss.clients) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      // Backpressure: se a conexão do cliente não está dando conta, pulamos ticks
      // (o próximo tick corrige). Eventos importantes (crash, bet...) nunca são pulados.
      if (msg.type === "tick" && ws.bufferedAmount > MAX_BUFFERED_BYTES) continue;
      ws.send(data);
    }
  });

  // Heartbeat: a cada 30s mandamos um "ping". Quem não respondeu "pong" desde
  // o último ping caiu sem avisar (wifi caiu, aba congelou): derrubamos a conexão.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.get(ws)) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
  }, HEARTBEAT_MS);
  wss.on("close", () => clearInterval(heartbeat));
}
