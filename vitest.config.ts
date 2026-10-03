import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: { alias: { "@": resolve(__dirname, ".") } },
  test: {
    environment: "edge-runtime",

    env: {
      TOKEN_ENCRYPTION_KEY: "dGVzdC10b2tlbi1lbmNyeXB0aW9uLWtleS0zMmJ5ISE=",
      BOARD_ORIGIN: "http://localhost:3000",
    },
    server: {
      deps: {
        inline: ["convex-test"],
      },
    },
  },
});
