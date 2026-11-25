import { useEffect, useState } from "react";

/**
 * Relógio que re-renderiza o componente a cada `intervalMs`.
 * Usado SÓ por quem precisa de contagem regressiva (ex.: card de fichas grátis),
 * para o resto do app não re-renderizar a cada segundo à toa.
 */
export function useNow(intervalMs: number, enabled = true): number {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setNow(performance.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, enabled]);
  return now;
}
