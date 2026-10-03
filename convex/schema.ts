import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  connectReference,
  decision,
  disconnectOutcome,
  principal,
  snapshot,
  supersededGrant,
} from "./scope";

export default defineSchema({
  ...authTables,
  connectedAccounts: defineTable({
    ownerId: v.id("users"),
    integrationId: v.string(),
    label: v.string(),
    providerName: v.string(),
    accessDescription: v.string(),
    providerUserId: v.string(),
    providerTenantId: v.optional(v.string()),
    providerEmail: v.optional(v.string()),
    baseName: v.optional(v.string()),
    connect: connectReference,
    grantedScopes: v.array(v.string()),
    profileId: v.string(),
    profileVersion: v.number(),
    grantVersion: v.number(),
    state: v.union(v.literal("active"), v.literal("blocked")),
    blockedAt: v.optional(v.number()),
    disconnectOutcome: v.optional(disconnectOutcome),
  })
    // Owner history and active-account lookup have distinct ordering.
    // eslint-disable-next-line @convex-dev/no-duplicate-indexes
    .index("by_ownerId", ["ownerId"])
    .index("by_ownerId_and_state", ["ownerId", "state"]),
  connectionAttempts: defineTable({
    ownerId: v.id("users"),
    integrationId: v.string(),
    providerName: v.string(),
    accessDescription: v.string(),
    connect: connectReference,
    profileId: v.string(),
    profileVersion: v.number(),
    proofHash: v.string(),
    targetAccountId: v.optional(v.id("connectedAccounts")),
    targetGrantVersion: v.optional(v.number()),
    accountId: v.optional(v.id("connectedAccounts")),
    superseded: v.optional(supersededGrant),
    expiresAt: v.number(),
  }).index("by_expiresAt", ["expiresAt"]),
  clientConnections: defineTable({
    ownerId: v.id("users"),
    ...principal.fields,
    name: v.string(),
    stoppedAt: v.optional(v.number()),
  })
    // Owner history also includes stopped clients.
    // eslint-disable-next-line @convex-dev/no-duplicate-indexes
    .index("by_ownerId", ["ownerId"])
    .index("by_ownerId_and_clientId_and_stoppedAt", [
      "ownerId",
      "clientId",
      "stoppedAt",
    ])
    .index("by_issuer_and_subject_and_clientId_and_consentId", [
      "issuer",
      "subject",
      "clientId",
      "consentId",
    ]),
  approvalRequests: defineTable({
    ownerId: v.id("users"),
    requesterConnectionId: v.id("clientConnections"),
    collectorConnectionId: v.id("clientConnections"),
    accountId: v.id("connectedAccounts"),
    key: v.string(),
    integrationId: v.string(),
    grantVersion: v.number(),
    profileId: v.string(),
    profileVersion: v.number(),
    snapshot,
    reason: v.string(),
    intent: v.optional(v.string()),
    status: decision,
    approvalExpiresAt: v.number(),
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
    // eslint-disable-next-line @convex-dev/no-duplicate-indexes
    .index("by_ownerId", ["ownerId"])
    .index("by_ownerId_and_status_and_approvalExpiresAt", [
      "ownerId",
      "status",
      "approvalExpiresAt",
    ]),
  pushSubscriptions: defineTable({
    ownerId: v.id("users"),
    endpoint: v.string(),
    p256dh: v.string(),
    auth: v.string(),
  }).index("by_ownerId", ["ownerId"]),
  notificationJobs: defineTable({
    requestId: v.id("approvalRequests"),
    subscriptionId: v.id("pushSubscriptions"),
    status: v.union(
      v.literal("pending"),
      v.literal("sent"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    attempts: v.number(),
    lease: v.optional(v.string()),
    leaseUntil: v.optional(v.number()),
  }).index("by_requestId", ["requestId"]),
});
