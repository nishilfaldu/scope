import resend from "@convex-dev/resend/convex.config.js";
import { defineApp } from "convex/server";
import { v } from "convex/values";

const app = defineApp({
  env: {
    SCOPE_PROBE_SECRET: v.optional(v.string()),
    SCOPE_VAPID_PUBLIC_KEY: v.optional(v.string()),
    SCOPE_VAPID_PRIVATE_KEY: v.optional(v.string()),
    CONNECT_BRIDGE_URL: v.optional(v.string()),
    CONNECT_BRIDGE_SECRET: v.optional(v.string()),
    CONNECT_BRIDGE_PROTECTION_COOKIE: v.optional(v.string()),
    BOARD_ORIGIN: v.string(),
    RESEND_API_KEY: v.string(),

    RESEND_FROM: v.optional(v.string()),

    TOKEN_ENCRYPTION_KEY: v.string(),
  },
});
app.use(resend);

export default app;
