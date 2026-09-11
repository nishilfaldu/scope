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
  })
    .index("by_token", ["token"])
    .index("by_status", ["status"]),

  passportLogs: defineTable({
    passportId: v.id("passports"),
    action: v.string(),
    status: v.number(),
    ok: v.boolean(),
    error: v.union(v.string(), v.null()),
    argsPreview: v.string(),
  }).index("by_passport", ["passportId"]),

  connections: defineTable({
    provider: v.string(),
    accessToken: v.string(),
    login: v.string(),
    providerUserId: v.string(),
    refreshToken: v.optional(v.string()),
    tokenExpiresAt: v.optional(v.number()),
  }).index("by_provider", ["provider"]),

  oauthStates: defineTable({
    provider: v.string(),
    state: v.string(),
    returnTo: v.string(),
    expiresAt: v.number(),
  }).index("by_state", ["state"]),

  providerCredentials: defineTable({
    provider: v.string(),
    clientId: v.string(),
    clientSecret: v.string(),
    slug: v.optional(v.string()),
    pendingReturnTo: v.optional(v.string()),
  }).index("by_provider", ["provider"]),
});
