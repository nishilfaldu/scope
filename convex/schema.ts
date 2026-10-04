import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  connectReference,
  accessStatus,
  section,
  disconnectOutcome,
  snapshot,
} from "./scope";

export default defineSchema({
  connectedAccounts: defineTable({
    ownerId: v.string(),
    visible: v.boolean(),
    provisional: v.boolean(),
    providerId: v.string(),
    label: v.string(),
    providerName: v.string(),
    accessDescription: v.string(),
    providerUserId: v.optional(v.string()),
    providerTenantId: v.optional(v.string()),
    providerEmail: v.optional(v.string()),
    connect: connectReference,
    grantedScopes: v.array(v.string()),
    authorizationKey: v.optional(v.string()),
    grantVersion: v.number(),
    state: v.union(
      v.literal("connecting"),
      v.literal("active"),
      v.literal("blocked"),
    ),
    setupExpiresAt: v.optional(v.number()),
    proofHash: v.optional(v.string()),
    requestedScopes: v.optional(v.array(v.string())),
    setupIssue: v.optional(v.string()),
    blockedAt: v.optional(v.number()),
    disconnectOutcome: v.optional(disconnectOutcome),
  })
    .index("by_ownerId_and_visible_and_state", ["ownerId", "visible", "state"])
    .index("by_authorizationKey_and_provisional_and_visible", [
      "authorizationKey",
      "provisional",
      "visible",
    ]),
  accessApprovals: defineTable({
    ownerId: v.string(),
    issuer: v.string(),
    clientId: v.string(),
    sessionId: v.string(),
    accountId: v.id("connectedAccounts"),
    grantVersion: v.number(),
    providerId: v.string(),
    snapshot,
    reason: v.string(),
    status: accessStatus,
    section,
    waitingUntil: v.number(),
    approvedAt: v.optional(v.number()),
    until: v.optional(v.number()),
    deniedAt: v.optional(v.number()),
    endedAt: v.optional(v.number()),
    endReason: v.optional(v.string()),
    firstCollectedAt: v.optional(v.number()),
    lastCollectedAt: v.optional(v.number()),
    collectionCount: v.number(),
    receivedAt: v.optional(v.number()),
    receiptProof: v.optional(v.string()),
  })
    .index("by_ownerId_and_section", ["ownerId", "section"])
    .index("by_actor_and_account_and_grant_and_status", [
      "ownerId",
      "issuer",
      "clientId",
      "sessionId",
      "accountId",
      "grantVersion",
      "status",
    ])
    .index("by_accountId_and_section", ["accountId", "section"]),
  pushSubscriptions: defineTable({
    ownerId: v.string(),
    endpoint: v.string(),
    p256dh: v.string(),
    auth: v.string(),
  }).index("by_ownerId", ["ownerId"]),
});
