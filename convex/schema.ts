import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  connectReference,
  decision,
  disconnectOutcome,
  principal,
  snapshot,
  command,
} from "./scope";

export default defineSchema({
  connectedAccounts: defineTable({
    ownerId: v.string(),
    providerId: v.string(),
    label: v.string(),
    providerName: v.string(),
    accessDescription: v.string(),
    providerUserId: v.string(),
    providerTenantId: v.optional(v.string()),
    providerEmail: v.optional(v.string()),
    connect: connectReference,
    grantedScopes: v.array(v.string()),
    authorizationKey: v.string(),
    grantVersion: v.number(),
    state: v.union(v.literal("active"), v.literal("blocked")),
    blockedAt: v.optional(v.number()),
    disconnectOutcome: v.optional(disconnectOutcome),
  })
    .index("by_ownerId_and_state_and_disconnectOutcome", [
      "ownerId",
      "state",
      "disconnectOutcome",
    ])
    .index("by_authorizationKey_and_disconnectOutcome", [
      "authorizationKey",
      "disconnectOutcome",
    ]),
  connectionAttempts: defineTable({
    ownerId: v.string(),
    providerId: v.string(),
    providerName: v.string(),
    accessDescription: v.string(),
    connect: connectReference,
    requestedScopes: v.array(v.string()),
    proofHash: v.string(),
    targetAccountId: v.optional(v.id("connectedAccounts")),
    targetGrantVersion: v.optional(v.number()),
    accountId: v.optional(v.id("connectedAccounts")),
    expiresAt: v.number(),
  }).index("by_expiresAt", ["expiresAt"]),
  clientConnections: defineTable({
    ownerId: v.string(),
    ...principal.fields,
    name: v.string(),
    stoppedAt: v.optional(v.number()),
  })
    .index("by_ownerId", ["ownerId"])
    .index("by_issuer_and_subject_and_clientId_and_sessionId", [
      "issuer",
      "subject",
      "clientId",
      "sessionId",
    ]),
  approvalRequests: defineTable({
    ownerId: v.string(),
    requesterConnectionId: v.id("clientConnections"),
    accountId: v.id("connectedAccounts"),
    key: v.string(),
    providerId: v.string(),
    grantVersion: v.number(),
    snapshot,
    reason: v.string(),
    command,
    status: decision,
    approvalExpiresAt: v.number(),
    expiredAt: v.optional(v.number()),
    expiryJobId: v.optional(v.id("_scheduled_functions")),
    decidedAt: v.optional(v.number()),
    stoppedAt: v.optional(v.number()),
    firstDeliveryAt: v.optional(v.number()),
    lastDeliveryAt: v.optional(v.number()),
    deliveryAttempts: v.optional(v.number()),
    providerExpiresAt: v.optional(v.number()),
    tokenId: v.optional(v.string()),
    receiptProof: v.optional(v.string()),
    receivedAt: v.optional(v.number()),
  })
    .index("by_requesterConnectionId_and_key", ["requesterConnectionId", "key"])
    // Chronological history must not be ordered by decision/deadline.
    .index("by_ownerId", ["ownerId"])
    .index("by_status_and_ownerId_and_expiredAt_and_approvalExpiresAt", [
      "status",
      "ownerId",
      "expiredAt",
      "approvalExpiresAt",
    ]),
  pushSubscriptions: defineTable({
    ownerId: v.string(),
    endpoint: v.string(),
    p256dh: v.string(),
    auth: v.string(),
  }).index("by_ownerId", ["ownerId"]),
});
