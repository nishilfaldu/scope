import resend from "@convex-dev/resend/convex.config.js";
import { defineApp } from "convex/server";
import { v } from "convex/values";

const app = defineApp({
  env: {
    GITHUB_CLIENT_ID: v.string(),
    GITHUB_CLIENT_SECRET: v.string(),
    GOOGLE_CLIENT_ID: v.string(),
    GOOGLE_CLIENT_SECRET: v.string(),
    SLACK_CLIENT_ID: v.string(),
    SLACK_CLIENT_SECRET: v.string(),
    AIRTABLE_CLIENT_ID: v.string(),
    AIRTABLE_CLIENT_SECRET: v.string(),
    NOTION_CLIENT_ID: v.string(),
    NOTION_CLIENT_SECRET: v.string(),
    LINEAR_CLIENT_ID: v.string(),
    LINEAR_CLIENT_SECRET: v.string(),
    VERCEL_CLIENT_ID: v.string(),
    VERCEL_CLIENT_SECRET: v.string(),
    ZOOM_CLIENT_ID: v.string(),
    ZOOM_CLIENT_SECRET: v.string(),
    BOARD_ORIGIN: v.optional(v.string()),
    RESEND_API_KEY: v.optional(v.string()),
    // Optional From header for OTP emails; falls back in auth.ts when unset.
    RESEND_FROM: v.optional(v.string()),
    // Base64-encoded 32-byte AES-256 key for connection token encryption at rest.
    TOKEN_ENCRYPTION_KEY: v.string(),
  },
});
app.use(resend);

export default app;
