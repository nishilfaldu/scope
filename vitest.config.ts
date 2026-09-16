import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "edge-runtime",
    // Required for connection save/read paths (AES-GCM). 32-byte key, base64.
    env: {
      TOKEN_ENCRYPTION_KEY: "dGVzdC10b2tlbi1lbmNyeXB0aW9uLWtleS0zMmJ5ISE=",
    },
    server: {
      deps: {
        inline: ["convex-test"],
      },
    },
  },
});
