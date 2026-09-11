import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { appValidator } from "./permissions";
import {
  actorTypeValidator,
  auditKindValidator,
  outcomeValidator,
} from "./auditFields";

export default defineSchema({
  passports: defineTable({
    name: v.string(),
    token: v.string(),
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

  passportLogs: defineTable({
    passportId: v.id("passports"),
    action: v.string(),
    status: v.number(),
    ok: v.boolean(),
    error: v.union(v.string(), v.null()),
    argsPreview: v.string(),
  }).index("by_passport", ["passportId"]),

  auditEvents: defineTable({
    passportId: v.id("passports"),
    kind: auditKindValidator,
    actorType: actorTypeValidator,
    actorId: v.string(),
    scopes: v.array(v.string()),
    outcome: outcomeValidator,
    reason: v.string(),
    service: v.union(v.string(), v.null()),
    action: v.union(v.string(), v.null()),
    argsPreview: v.union(v.string(), v.null()),
    httpStatus: v.union(v.number(), v.null()),
    occurredAt: v.number(),
    seq: v.number(),
    prevHash: v.union(v.string(), v.null()),
    hash: v.string(),
  })
    .index("by_passport", ["passportId"])
    .index("by_passport_and_kind", ["passportId", "kind"])
    .index("by_passport_and_outcome", ["passportId", "outcome"])
    .index("by_passport_and_actorType", ["passportId", "actorType"]),

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
});
