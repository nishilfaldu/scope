import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { appValidator } from "./domain/apps";
import { storedRequestStatusValidator } from "./domain/requests";

const sliceStatusValidator = v.union(v.literal("active"), v.literal("revoked"));

const mintPolicyValidator = v.union(v.literal("auto"), v.literal("approve"));
const agentConnectionStatusValidator = v.union(
  v.literal("staged"),
  v.literal("active"),
  v.literal("revoked"),
);

const requestLifecycle = {
  publicToken: v.string(),
  status: storedRequestStatusValidator,
  expiresAt: v.number(),
};

export default defineSchema({
  ...authTables,

  agentConnections: defineTable({
    userId: v.id("users"),
    agentId: v.string(),
    name: v.string(),
    secretHash: v.string(),
    status: agentConnectionStatusValidator,
    lastUsedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
  })
    // Keep creation-time ordering for owner history queries.
    // eslint-disable-next-line @convex-dev/no-duplicate-indexes
    .index("by_user", ["userId"])
    .index("by_user_status", ["userId", "status"])
    .index("by_agentId_status", ["agentId", "status"]),

  agentLineages: defineTable({
    agentId: v.string(),
    userId: v.id("users"),
    revokedAt: v.optional(v.number()),
  }).index("by_agentId", ["agentId"]),

  agentConnectionInvites: defineTable({
    publicToken: v.string(),
    claimSecretHash: v.string(),
    agentId: v.string(),
    agentName: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("denied"),
      v.literal("claimed"),
      v.literal("expired"),
    ),
    expiresAt: v.number(),
    userId: v.optional(v.id("users")),
    replacesAgentConnectionId: v.optional(v.id("agentConnections")),
    agentConnectionId: v.optional(v.id("agentConnections")),
    issuedSecretCipher: v.optional(v.string()),
    claimAcknowledgedAt: v.optional(v.number()),
  })
    .index("by_public_token", ["publicToken"])
    .index("by_claim_secret_hash", ["claimSecretHash"])
    .index("by_agent_connection_id", ["agentConnectionId"]),

  // A slice owns its lifecycle; individual app permissions are indexed below.
  slices: defineTable({
    userId: v.id("users"),
    agentId: v.string(),
    name: v.string(),
    token: v.string(),
    secretHash: v.string(),
    status: sliceStatusValidator,
    expiresAt: v.number(),
    mintPolicy: mintPolicyValidator,
    brokerWindowStart: v.optional(v.number()),
    brokerWindowCount: v.optional(v.number()),
  })
    .index("by_token", ["token"])
    .index("by_agentId", ["agentId"]),

  sliceBindings: defineTable({
    sliceId: v.id("slices"),
    app: appValidator,
    connectionId: v.id("connections"),
  })
    .index("by_slice_app_connectionId", ["sliceId", "app", "connectionId"])
    .index("by_connectionId", ["connectionId"]),

  sliceRequests: defineTable({
    ...requestLifecycle,
    claimSecretHash: v.string(),
    agentId: v.string(),
    userId: v.optional(v.id("users")),
    createdSliceId: v.optional(v.id("slices")),
    apps: v.array(appValidator),
    ttlMs: v.number(),
    reason: v.string(),
    issuedSliceSecretCipher: v.optional(v.string()),
    claimAcknowledgedAt: v.optional(v.number()),
    idempotencyKeyHash: v.optional(v.string()),
    claimHandleCipher: v.optional(v.string()),
  })
    .index("by_public_token", ["publicToken"])
    .index("by_claim_secret_hash", ["claimSecretHash"])
    .index("by_idempotency_key_hash", ["idempotencyKeyHash"])
    .index("by_agentId", ["agentId"])
    .index("by_userId_status_expiresAt", ["userId", "status", "expiresAt"])
    .index("by_status_expiresAt", ["status", "expiresAt"]),

  tokenRequests: defineTable({
    ...requestLifecycle,
    sliceId: v.id("slices"),
    app: appValidator,
    bindingId: v.id("sliceBindings"),
  })
    .index("by_public_token", ["publicToken"])
    .index("by_slice_status_expiresAt", ["sliceId", "status", "expiresAt"]),

  googleBrokerCredentials: defineTable({
    secretHash: v.string(),
    sliceId: v.id("slices"),
    bindingId: v.id("sliceBindings"),
    connectionId: v.id("connections"),
    app: v.union(v.literal("drive"), v.literal("docs"), v.literal("sheets")),
    connectionGeneration: v.number(),
    expiresAt: v.number(),
  }).index("by_secretHash", ["secretHash"]),

  // One row per (user, provider, app, provider account). Google apps each have
  // their own connection rows (and may bind different Google accounts).
  connections: defineTable({
    userId: v.id("users"),
    app: appValidator,
    accessToken: v.string(),
    login: v.string(),
    providerUserId: v.string(),
    refreshToken: v.optional(v.string()),
    tokenExpiresAt: v.optional(v.number()),
    grantVersion: v.number(),
    connectionGeneration: v.optional(v.number()),
    refreshLease: v.optional(v.string()),
    refreshLeaseExpiresAt: v.optional(v.number()),
    grantedScopes: v.optional(v.array(v.string())),
  }).index("by_user_app_providerUserId", ["userId", "app", "providerUserId"]),

  oauthStates: defineTable({
    userId: v.id("users"),
    app: appValidator,
    state: v.string(),
    browserProofHash: v.optional(v.string()),
    pkceVerifier: v.optional(v.string()),
    pkceChallenge: v.optional(v.string()),
    returnTo: v.string(),
    expiresAt: v.number(),
  }).index("by_state", ["state"]),
});
