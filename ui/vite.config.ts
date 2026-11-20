import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Q's RAG backend (FastAPI): uv run uvicorn hilde.api.main:app --port 8000
const API = process.env.Q_API_URL ?? "http://localhost:8000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    port: 5173,
    // the browser calls /api/... on the dev server, which forwards to the backend (no CORS needed)
    proxy: { "/api": { target: API, changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, "") } },
  },
});
