import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "edge-runtime",
    // Required for connection save/read paths (AES-GCM). 32-byte key, base64.
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
