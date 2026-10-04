import actionRetrier from "@convex-dev/action-retrier/convex.config";
import { defineApp } from "convex/server";
import { v } from "convex/values";

const app = defineApp({
  env: {
    SCOPE_SERVICE_SECRET: v.optional(v.string()),
    SCOPE_CLI_CLIENT_ID: v.optional(v.string()),
    SCOPE_VAPID_PUBLIC_KEY: v.optional(v.string()),
    SCOPE_VAPID_PRIVATE_KEY: v.optional(v.string()),
    SCOPE_ORIGIN: v.string(),
    WORKOS_CLIENT_ID: v.string(),
  },
});
app.use(actionRetrier);

export default app;
