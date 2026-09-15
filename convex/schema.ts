import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { appValidator, providerValidator } from "./domain/apps";
import { authTables } from "@convex-dev/auth/server";

export default defineSchema({
  ...authTables,

  passports: defineTable({
    name: v.string(),
    token: v.string(),
    passportSecretHash: v.optional(v.string()),
    status: v.union(
      v.literal("active"),
      v.literal("revoked"),
      v.literal("expired"),
    ),
    expiresAt: v.number(),
    apps: v.array(appValidator),
  })
    .index("by_token", ["token"])
    .index("by_status", ["status"])
    .index("by_status_and_expiresAt", ["status", "expiresAt"]),

  connections: defineTable({
    provider: providerValidator,
    accessToken: v.string(),
    login: v.string(),
    providerUserId: v.string(),
    refreshToken: v.optional(v.string()),
    tokenExpiresAt: v.optional(v.number()),
  }).index("by_provider", ["provider"]),

  oauthStates: defineTable({
    provider: providerValidator,
    state: v.string(),
    returnTo: v.string(),
    expiresAt: v.number(),
  }).index("by_state", ["state"]),
});
