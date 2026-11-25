import { useEffect, useRef } from "react";
import type { GameState } from "../game/state.ts";
import { CrashScene } from "../pixi/CrashScene.ts";

/**
 * A "ponte" entre React e PixiJS.
 *
 * O React NÃO redesenha o canvas: ele só cria a cena uma vez e a destrói ao sair.
 * O estado mais recente fica numa ref, que a cena lê a cada frame. Assim o
 * React re-renderiza ~10x/s (quando chegam mensagens), e o Pixi anima a 60fps
 * sem passar pelo React.
 */
export function GameCanvas({ state }: { state: GameState }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef(state);

  // Mantém a ref apontando para o estado mais novo (mudar uma ref não re-renderiza nada).
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const scene = new CrashScene(() => stateRef.current);
    scene.mount(host).catch((err: unknown) => console.error("[pixi] falha ao iniciar", err));
    return () => scene.destroy(); // libera GPU, listeners e o canvas
  }, []);

  return <div ref={hostRef} className="game-canvas" />;
}
