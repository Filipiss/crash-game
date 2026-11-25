import { formatMultiplier } from "../format.ts";

/** Cor por faixa: as "pílulas" deixam o padrão das rodadas visível num relance. */
function tier(multiplier: number): "low" | "mid" | "high" {
  if (multiplier < 2) return "low";
  if (multiplier < 10) return "mid";
  return "high";
}

export function HistoryBar({ history }: { history: number[] }) {
  return (
    <div className="history" aria-label="Últimos resultados">
      {history.length === 0 && <span className="history-empty">Sem rodadas ainda</span>}
      {history.map((m, i) => (
        // A key combina índice e valor: o histórico só cresce pelo começo.
        <span key={`${history.length - i}-${m}`} className={`pill pill-${tier(m)}`}>
          {formatMultiplier(m)}
        </span>
      ))}
    </div>
  );
}
