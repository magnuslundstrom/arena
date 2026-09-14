import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

const gameServer = process.env.GAME_SERVER_URL ?? "http://127.0.0.1:3001";

export default defineConfig({
  plugins: [solid()],
  server: {
    proxy: {
      "/connect": { target: gameServer, ws: true },
      "/status": { target: gameServer },
    },
  },
});
