import { useEffect } from "react";
import { Link, useLocation } from "react-router";

/** Rota "*": qualquer URL que não existe (ex.: /xyz). */
export function NotFoundPage() {
  const { pathname } = useLocation();

  useEffect(() => {
    document.title = "Página não encontrada · Rocket Crash";
  }, []);

  return (
    <main className="not-found">
      <div className="not-found-art" aria-hidden>
        🛸
      </div>
      <h1>Perdido no espaço</h1>
      <p className="muted">
        A página <code>{pathname}</code> não existe (ou foi abduzida).
      </p>
      <Link to="/" className="pay-btn link-btn">
        Voltar ao jogo
      </Link>
    </main>
  );
}
