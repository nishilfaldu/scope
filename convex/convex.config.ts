import { defineApp } from "convex/server";
import { v } from "convex/values";

const app = defineApp({
  env: {
    GITHUB_CLIENT_ID: v.optional(v.string()),
    GITHUB_CLIENT_SECRET: v.optional(v.string()),
    GOOGLE_CLIENT_ID: v.optional(v.string()),
    GOOGLE_CLIENT_SECRET: v.optional(v.string()),
    SLACK_CLIENT_ID: v.optional(v.string()),
    SLACK_CLIENT_SECRET: v.optional(v.string()),
    BOARD_ORIGIN: v.optional(v.string()),
  },
});

export default app;
