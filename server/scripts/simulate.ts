// Prova empírica da matemática: simula 1 milhão de rodadas e mede o RTP
// (quanto volta para o jogador, em média) para várias estratégias de cash-out.
// Rodar: npm run simulate -w server
import { generateCrashPoint, HOUSE_EDGE } from "../src/crash-point.ts";

const ROUNDS = 1_000_000;
const targets = [1.1, 1.5, 2, 5, 10, 100];

const crashes = Array.from({ length: ROUNDS }, generateCrashPoint);

console.log(`RTP esperado: ${((1 - HOUSE_EDGE) * 100).toFixed(1)}%  (${ROUNDS.toLocaleString("pt-BR")} rodadas)\n`);
for (const target of targets) {
  // Aposta 1 por rodada; ganha `target` se o crash veio em `target` ou depois.
  const won = crashes.filter((c) => c >= target).length;
  const rtp = (won * target) / ROUNDS;
  console.log(`cash-out em ${target.toFixed(2).padStart(6)}x -> RTP ${(rtp * 100).toFixed(2)}%  (ganhou ${((won / ROUNDS) * 100).toFixed(1)}% das rodadas)`);
}

const instant = crashes.filter((c) => c === 1).length;
console.log(`\nRodadas que crasharam em 1.00x (ninguém ganha): ${((instant / ROUNDS) * 100).toFixed(2)}%`);
