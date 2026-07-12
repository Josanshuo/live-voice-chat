import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // "/" for local dev; the Docker build passes VITE_BASE_PATH=/voice/ so the
  // app can live under LibreChat's domain at chat.ctrpg.wiki/voice/.
  base: process.env.VITE_BASE_PATH || "/",
  plugins: [react()],
  server: {
    port: Number(process.env.PORT) || 5173,
    proxy: {
      // keep in sync with the token service port (server/index.mjs)
      "/api": `http://localhost:${process.env.TOKEN_SERVER_PORT || 8787}`,
    },
  },
});
