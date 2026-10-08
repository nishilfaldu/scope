import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": resolve(__dirname, ".") } },
  test: {
    environment: "edge-runtime",

    env: {
      SCOPE_ORIGIN: "http://localhost:3000",
      WORKOS_CLIENT_ID: "client_web",
      WORKOS_AUTHKIT_DOMAIN: "https://auth.test",
      SCOPE_MCP_RESOURCE: "http://localhost:3000/mcp",
    },
    server: {
      deps: {
        inline: ["convex-test"],
      },
    },
  },
});
