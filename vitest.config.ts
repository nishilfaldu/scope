import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: { alias: { "@": resolve(__dirname, ".") } },
  test: {
    environment: "edge-runtime",

    env: {
      SCOPE_ORIGIN: "http://localhost:3000",
    },
    server: {
      deps: {
        inline: ["convex-test"],
      },
    },
  },
});
