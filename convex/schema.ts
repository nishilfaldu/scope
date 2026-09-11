import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { accountAppValidator, appValidator, providerValidator } from "./permissions";
import {
  auditEventValidator,
  tokenLogKindValidator,
} from "./auditFields";

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

  platformTokens: defineTable({
    passportId: v.id("passports"),
    platform: accountAppValidator,
    accessToken: v.string(),
    status: v.union(v.literal("live"), v.literal("revoked")),
    expiresAt: v.number(),
    revokedAt: v.optional(v.number()),
    revokeReason: v.optional(v.string()),
  })
    .index("by_passport", ["passportId"])
    .index("by_passport_and_platform", ["passportId", "platform"])
    .index("by_passport_and_status", ["passportId", "status"])
    .index("by_status_and_expiresAt", ["status", "expiresAt"]),

  tokenLogs: defineTable({
    passportId: v.id("passports"),
    platform: v.string(),
    kind: tokenLogKindValidator,
    reason: v.string(),
    occurredAt: v.number(),
  })
    .index("by_passport", ["passportId"])
    .index("by_passport_and_kind", ["passportId", "kind"]),

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
