import { defineTable } from "convex/server";
import { v } from "convex/values";

export const probeTables = {
  probeAccounts: defineTable({
    userId: v.id("users"),
    label: v.string(),
    providerEmail: v.optional(v.string()),
    baseName: v.optional(v.string()),
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
  probeRequesters: defineTable({
    userId: v.id("users"),
    requester: v.string(),
    name: v.string(),
    stoppedAt: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_requester", ["requester"]),
  probeConnectionAttempts: defineTable({
    userId: v.id("users"),
    subjectId: v.string(),
    issuer: v.string(),
    connectorId: v.string(),
    proofHash: v.string(),
    accountId: v.optional(v.id("probeAccounts")),
    expiresAt: v.number(),
  }).index("by_expiry", ["expiresAt"]),
  probeRequests: defineTable({
    userId: v.id("users"),
    requester: v.string(),
    key: v.string(),
    accountId: v.id("probeAccounts"),
    reason: v.string(),
    intent: v.optional(v.string()),
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
    // Chronological status history uses creation order, not deadline order.
    // eslint-disable-next-line @convex-dev/no-duplicate-indexes
    .index("by_user_status", ["userId", "status"])
    .index("by_user_status_deadline", ["userId", "status", "expiresAt"])
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
