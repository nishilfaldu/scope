import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { appValidator, providerValidator } from "./permissions";
import { auditEventValidator } from "./tables/auditEvents/fields";

export default defineSchema({
  passports: defineTable({
    name: v.string(),
    token: v.string(),
    invokeKeyHash: v.optional(v.string()),
    status: v.union(
      v.literal("active"),
      v.literal("revoked"),
      v.literal("expired"),
    ),
    expiresAt: v.number(),
    apps: v.array(appValidator),
    auditSeq: v.optional(v.number()),
    auditHeadHash: v.optional(v.string()),
  })
    .index("by_token", ["token"])
    .index("by_status", ["status"])
    .index("by_status_and_expiresAt", ["status", "expiresAt"]),

  auditEvents: defineTable(auditEventValidator)
    .index("by_passport", ["passportId"])
    .index("by_passport_and_kind", ["passportId", "kind"])
    .index("by_passport_and_outcome", ["passportId", "outcome"])
    .index("by_passport_and_actorType", ["passportId", "actorType"]),

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
