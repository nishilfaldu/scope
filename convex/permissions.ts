import { Infer, v } from "convex/values";

export const appValidator = v.union(v.literal("demo"), v.literal("github"));

export type AppId = Infer<typeof appValidator>;
