import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./App.tsx";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* BrowserRouter: as rotas usam URLs "de verdade" (/perfil), via History API do navegador */}
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
