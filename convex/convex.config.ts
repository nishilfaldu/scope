import resend from "@convex-dev/resend/convex.config.js";
import { defineApp } from "convex/server";
import { v } from "convex/values";

const app = defineApp({
  env: {
    SCOPE_SERVICE_SECRET: v.optional(v.string()),
    SCOPE_VAPID_PUBLIC_KEY: v.optional(v.string()),
    SCOPE_VAPID_PRIVATE_KEY: v.optional(v.string()),
    SCOPE_HELPER_CLIENT_ID: v.optional(v.string()),
    SCOPE_ORIGIN: v.string(),
    RESEND_API_KEY: v.string(),

    RESEND_FROM: v.optional(v.string()),
  },
});
app.use(resend);

export default app;
