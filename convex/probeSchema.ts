import { defineTable } from "convex/server";
import { v } from "convex/values";

export const probeTables = {
  probeAccounts: defineTable({
    userId: v.id("users"),
    label: v.string(),
    subjectId: v.string(),
    issuer: v.string(),
    connectorId: v.string(),
    installationId: v.optional(v.string()),
    providerUserId: v.optional(v.string()),
    revoked: v.boolean(),
  }).index("by_user", ["userId"]),
  probeRequests: defineTable({
    userId: v.id("users"),
    requester: v.string(),
    key: v.string(),
    accountId: v.id("probeAccounts"),
    reason: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("denied"),
    ),
    expiresAt: v.number(),
    lease: v.optional(v.string()),
    leaseUntil: v.optional(v.number()),
    credentialId: v.optional(v.id("probeCredentials")),
    deliveredAt: v.optional(v.number()),
  })
    .index("by_requester_key", ["requester", "key"])
    .index("by_user", ["userId"]),
  probeCredentials: defineTable({
    userId: v.id("users"),
    accountId: v.id("probeAccounts"),
    fingerprint: v.string(),
    cipher: v.string(),
    expiresAt: v.number(),
  })
    .index("by_account_fingerprint", ["accountId", "fingerprint"])
    .index("by_user", ["userId"]),
  probePush: defineTable({
    userId: v.id("users"),
    endpoint: v.string(),
    p256dh: v.string(),
    auth: v.string(),
  }).index("by_user", ["userId"]),
};
