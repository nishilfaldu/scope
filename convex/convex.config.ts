import { defineApp } from "convex/server";
import { v } from "convex/values";

const app = defineApp({
  env: {
    SCOPE_VAPID_PUBLIC_KEY: v.optional(v.string()),
    SCOPE_VAPID_PRIVATE_KEY: v.optional(v.string()),
    WORKOS_CLIENT_ID: v.string(),
    // MCP access tokens. Both must be set for the gateway to accept apps.
    WORKOS_AUTHKIT_DOMAIN: v.optional(v.string()),
    SCOPE_MCP_RESOURCE: v.optional(v.string()),
  },
});

export default app;
