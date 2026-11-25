import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import compression from "compression";
import express from "express";
import { CrashGame } from "./game.ts";
import { PlayerStore } from "./players.ts";
import { attachRealtime } from "./realtime.ts";
import { createApiRouter, errorHandler } from "./routes.ts";

// Em produção, os serviços de hospedagem (Render, Railway, Fly...) dizem a porta pela
// variável PORT. Em dev (`--dev`), a porta é FIXA em 3001, porque é para lá que o proxy
// do Vite aponta, mesmo que alguma ferramenta tenha definido PORT no ambiente (aconteceu!).
const DEV_PORT = 3001;
const PORT = process.argv.includes("--dev") ? DEV_PORT : Number(process.env.PORT ?? DEV_PORT);

// O jogo roda no servidor, sozinho, independente de ter alguém conectado.
// O jogo decide QUANTO pagar; a carteira credita (injeção de dependência: o jogo
// não conhece a carteira, só recebe uma função "pague X para o jogador Y").
const players = new PlayerStore();
const game = new CrashGame((playerId, cents) => players.creditById(playerId, cents));

const app = express();
// gzip nas respostas HTTP: o JS do jogo cai de ~551 KB para ~168 KB na rede.
// (O WebSocket não passa por aqui; as mensagens dele já são pequenas.)
app.use(compression());
app.use(express.json()); // transforma o corpo JSON dos pedidos em req.body
app.use("/api", createApiRouter(game, players)); // todas as rotas REST ficam sob /api
app.use(errorHandler); // precisa vir DEPOIS das rotas

// Em produção, o próprio servidor entrega o cliente compilado (client/dist):
// página, API e WebSocket na MESMA origem -> sem CORS e sem proxy.
const clientDist = fileURLToPath(new URL("../../client/dist", import.meta.url));
if (existsSync(clientDist)) {
  // Os arquivos em /assets têm um hash no nome (index-a1b2c3.js): se o conteúdo
  // muda, o nome muda. Então o navegador pode guardá-los "para sempre" (cache de 1 ano).
  app.use("/assets", express.static(join(clientDist, "assets"), { immutable: true, maxAge: "1y" }));
  // O index.html NÃO tem hash: sem cache longo, senão o jogador nunca veria a versão nova.
  app.use(express.static(clientDist));
  console.log(`Servindo o cliente compilado de ${clientDist}`);
}

// Log no console (útil para depurar). O WebSocket se inscreve separadamente em
// attachRealtime(): os dois são "ouvintes" independentes do mesmo jogo.
game.onEvent((msg) => {
  switch (msg.type) {
    case "betting":
      console.log(`[rodada ${msg.roundId}] apostas abertas por ${msg.durationMs / 1000}s`);
      break;
    case "running":
      console.log(`[rodada ${msg.roundId}] decolou!`);
      break;
    case "crashed":
      console.log(`[rodada ${msg.roundId}] CRASH em ${msg.crashPoint.toFixed(2)}x`);
      break;
    case "bet":
      console.log(`[rodada ${msg.roundId}] ${msg.bet.playerName} apostou ${msg.bet.amountCents} centavos`);
      break;
    case "cashout":
      console.log(
        `[rodada ${msg.roundId}] ${msg.win.playerName} saiu em ${msg.win.multiplier}x` +
          `${msg.win.auto ? " (auto)" : ""}: ${msg.win.payoutCents} centavos`,
      );
      break;
    // "tick" acontece 10x por segundo: não vamos poluir o console com ele.
  }
});

game.start();

// Criamos o servidor HTTP "na mão" (em vez de app.listen) para que o
// WebSocket compartilhe esta mesma porta: HTTP em /api, WebSocket em /ws.
const httpServer = createServer(app);
attachRealtime(httpServer, game);

httpServer.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
