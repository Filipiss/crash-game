import type { ServerMessage } from "../../../shared/protocol.ts";

export type ConnectionStatus = "connecting" | "open" | "reconnecting";

/** Monta a URL do WebSocket na mesma origem da página (o proxy do Vite repassa /ws). */
export function defaultSocketUrl(): string {
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${location.host}/ws`;
}

/**
 * Envolve o WebSocket nativo do navegador e adiciona o que ele não tem:
 * - reconexão automática com "exponential backoff" (espera 0.5s, 1s, 2s, 4s... até 10s)
 * - mensagens já convertidas de JSON e tipadas como ServerMessage
 * - inscrição de vários ouvintes (onMessage / onStatus)
 *
 * Não sabe nada de React: pode ser usado por qualquer parte do app.
 */
export class GameSocket {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closedOnPurpose = false;
  private messageListeners = new Set<(msg: ServerMessage) => void>();
  private statusListeners = new Set<(status: ConnectionStatus) => void>();
  private readonly url: string;

  constructor(url: string = defaultSocketUrl()) {
    this.url = url;
  }

  connect(): void {
    this.closedOnPurpose = false;
    this.setStatus(this.attempt === 0 ? "connecting" : "reconnecting");

    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.onopen = () => {
      this.attempt = 0;
      this.setStatus("open");
    };

    ws.onmessage = (event) => {
      // Se o JSON vier quebrado, melhor saber no console do que derrubar o app.
      let msg: ServerMessage;
      try {
        msg = JSON.parse(event.data as string) as ServerMessage;
      } catch (err) {
        console.error("[ws] mensagem inválida", event.data, err);
        return;
      }
      for (const listener of this.messageListeners) listener(msg);
    };

    ws.onclose = () => {
      this.ws = null;
      if (this.closedOnPurpose) return;
      this.scheduleReconnect();
    };
    // onerror sempre vem seguido de onclose, então a reconexão é tratada lá.
  }

  /** Fecha de propósito (ex.: componente desmontou): NÃO tenta reconectar. */
  close(): void {
    this.closedOnPurpose = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }

  onMessage(listener: (msg: ServerMessage) => void): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onStatus(listener: (status: ConnectionStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  private scheduleReconnect(): void {
    this.attempt++;
    this.setStatus("reconnecting");
    // Exponential backoff + "jitter" (um pouco de aleatoriedade): se o servidor cair,
    // os milhares de clientes não voltam todos no MESMO milissegundo e o derrubam de novo.
    const delay = Math.min(10_000, 500 * 2 ** (this.attempt - 1)) + Math.random() * 250;
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private setStatus(status: ConnectionStatus): void {
    for (const listener of this.statusListeners) listener(status);
  }
}
