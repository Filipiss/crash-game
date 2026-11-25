import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // expõe na rede local -> dá pra abrir no celular pelo IP do PC
    proxy: {
      // O navegador chama /api e /ws na MESMA origem do Vite (porta 5173),
      // e o Vite repassa para o servidor (porta 3001). Assim evitamos CORS.
      "/api": "http://localhost:3001",
      "/ws": { target: "ws://localhost:3001", ws: true },
    },
  },
});
