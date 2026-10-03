import { defineTable } from "convex/server";
import { v } from "convex/values";

export const probeTables = {
  probeAccounts: defineTable({
    userId: v.id("users"),
    label: v.string(),
    subjectId: v.string(),
    issuer: v.string(),
    connectorId: v.string(),
    credentialKind: v.optional(v.literal("shared-pat")),
    baseId: v.optional(v.string()),
    installationId: v.optional(v.string()),
    providerUserId: v.optional(v.string()),
    revoked: v.boolean(),
    blockedAt: v.optional(v.number()),
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
      v.literal("cancelled"),
    ),
    expiresAt: v.number(),
    lease: v.optional(v.string()),
    leaseUntil: v.optional(v.number()),
    credentialId: v.optional(v.id("probeCredentials")),
    deliveredAt: v.optional(v.number()),
    decidedAt: v.optional(v.number()),
    stoppedAt: v.optional(v.number()),
    receivedAt: v.optional(v.number()),
    deliveryAttempts: v.optional(v.number()),
    deliveryCipher: v.optional(v.string()),
    deliveryExpiresAt: v.optional(v.number()),
    receiptId: v.optional(v.string()),
    cleanupAt: v.optional(v.number()),
  })
    .index("by_requester_key", ["requester", "key"])
    // Chronological owner history needs a separate order from status grouping.
    // eslint-disable-next-line @convex-dev/no-duplicate-indexes
    .index("by_user", ["userId"])
    .index("by_user_status", ["userId", "status"])
    .index("by_credential", ["credentialId"])
    .index("by_cleanup", ["cleanupAt"]),
  probeCredentials: defineTable({
    userId: v.id("users"),
    accountId: v.id("probeAccounts"),
    fingerprint: v.string(),
    cipher: v.optional(v.string()),
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
  probeNotifications: defineTable({
    requestId: v.id("probeRequests"),
    subscriptionId: v.id("probePush"),
    status: v.union(
      v.literal("pending"),
      v.literal("sent"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    attempts: v.number(),
    lease: v.optional(v.string()),
    leaseUntil: v.optional(v.number()),
  }).index("by_request", ["requestId"]),
};
