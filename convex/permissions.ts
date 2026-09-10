import { v } from "convex/values";

export const ALL_APPS = ["demo", "github"] as const;

export type AppId = (typeof ALL_APPS)[number];

export const appValidator = v.union(v.literal("demo"), v.literal("github"));
