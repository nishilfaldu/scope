import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { appValidator, providerValidator } from "./domain/apps";
import { authTables } from "@convex-dev/auth/server";
import { storedRequestStatusValidator } from "./domain/requests";

const sliceStatusValidator = v.union(
  v.literal("active"),
  v.literal("revoked"),
);

const mintPolicyValidator = v.union(v.literal("auto"), v.literal("approve"));

const requestBase = {
  publicToken: v.string(),
  claimSecretHash: v.string(),
  status: storedRequestStatusValidator,
  expiresAt: v.number(),
  decidedAt: v.optional(v.number()),
  claimedAt: v.optional(v.number()),
};

export default defineSchema({
  ...authTables,

  // A slice owns its lifecycle; individual app permissions are indexed below.
  slices: defineTable({
    userId: v.id("users"),
    name: v.string(),
    token: v.string(),
    secretHash: v.string(),
    status: sliceStatusValidator,
    expiresAt: v.number(),
    mintPolicy: mintPolicyValidator,
  })
    .index("by_token", ["token"])
    .index("by_user", ["userId"]),

  sliceBindings: defineTable({
    sliceId: v.id("slices"),
    app: appValidator,
    connectionId: v.id("connections"),
  })
    .index("by_slice_app", ["sliceId", "app"])
    .index("by_slice", ["sliceId"]),

  // Access requests cover two kinds:
  // - onboarding: agent-initiated grant request before any slice exists.
  //   Approve creates the slice; claim returns sliceToken/sliceSecret once.
  // - mint: operator approval for a short-lived credential on an existing slice.
  accessRequests: defineTable(v.union(
    v.object({
      ...requestBase,
      kind: v.literal("onboarding"),
      userId: v.optional(v.id("users")),
      sliceId: v.optional(v.id("slices")),
      agentName: v.string(),
      apps: v.array(appValidator),
      ttlMs: v.number(),
      reason: v.optional(v.string()),
      issuedSliceToken: v.optional(v.string()),
      issuedSliceSecretCipher: v.optional(v.string()),
    }),
    v.object({
      ...requestBase,
      kind: v.literal("mint"),
      userId: v.id("users"),
      sliceId: v.id("slices"),
      app: appValidator,
    }),
  ))
    .index("by_public_token", ["publicToken"])
    .index("by_claim_secret_hash", ["claimSecretHash"])
    .index("by_slice", ["sliceId"])
    .index("by_slice_status_expiresAt", ["sliceId", "status", "expiresAt"])
    .index("by_user_status_expiresAt", ["userId", "status", "expiresAt"])
    .index("by_kind_status_expiresAt", ["kind", "status", "expiresAt"]),

  // One row per (user, provider, app, provider account). Google apps each have
  // their own connection rows (and may bind different Google accounts).
  connections: defineTable({
    userId: v.id("users"),
    provider: providerValidator,
    app: appValidator,
    accessToken: v.string(),
    login: v.string(),
    providerUserId: v.string(),
    refreshToken: v.optional(v.string()),
    tokenExpiresAt: v.optional(v.number()),
  })
    .index("by_user_provider_app_providerUserId", [
      "userId",
      "provider",
      "app",
      "providerUserId",
    ]),

  oauthStates: defineTable({
    userId: v.id("users"),
    provider: providerValidator,
    app: appValidator,
    state: v.string(),
    returnTo: v.string(),
    expiresAt: v.number(),
  }).index("by_state", ["state"]),
});
