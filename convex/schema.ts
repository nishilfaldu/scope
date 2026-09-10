import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { appValidator } from "./permissions";

export default defineSchema({
  passports: defineTable({
    name: v.string(),
    token: v.string(),
    status: v.union(v.literal("active"), v.literal("revoked")),
    expiresAt: v.number(),
    apps: v.array(appValidator),
    lastAction: v.optional(v.string()),
    lastActionAt: v.optional(v.number()),
    lastActionOk: v.optional(v.boolean()),
    lastError: v.optional(v.string()),
  })
    .index("by_token", ["token"])
    .index("by_status", ["status"]),
});
