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
    VERCEL_CLIENT_ID: v.string(),
    VERCEL_CLIENT_SECRET: v.string(),
    BOARD_ORIGIN: v.string(),
  },
});

export default app;
