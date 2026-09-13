import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@arena/game-content": fileURLToPath(
        new URL("../game-content/src/index.ts", import.meta.url),
      ),
    },
  },
});
