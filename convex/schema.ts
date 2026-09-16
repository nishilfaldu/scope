import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { appValidator, providerValidator } from "./domain/apps";
import { authTables } from "@convex-dev/auth/server";

const sliceStatusValidator = v.union(
  v.literal("active"),
  v.literal("revoked"),
  v.literal("expired"),
);

const mintPolicyValidator = v.union(v.literal("auto"), v.literal("approve"));

const accessRequestStatusValidator = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("denied"),
  v.literal("expired"),
  v.literal("claimed"),
);

const accessRequestKindValidator = v.union(
  v.literal("onboarding"),
  v.literal("mint"),
);

const grantBindingValidator = v.object({
  app: appValidator,
  connectionId: v.id("connections"),
});

export default defineSchema({
  ...authTables,

  // A passport is the user-owned vault: it holds connected services and the
  // slices created from it. It has no external credential of its own.
  passports: defineTable({
    userId: v.id("users"),
    name: v.string(),
  }).index("by_user", ["userId"]),

  // A slice is one agent's scoped, expiring grant from one passport.
  slices: defineTable({
    passportId: v.id("passports"),
    grantId: v.id("grants"),
    userId: v.id("users"),
    name: v.string(),
    token: v.string(),
    secretHash: v.string(),
    status: sliceStatusValidator,
    expiresAt: v.number(),
    // Missing on older rows means auto (pre-launch default).
    mintPolicy: v.optional(mintPolicyValidator),
  })
    .index("by_token", ["token"])
    .index("by_user", ["userId"])
    .index("by_passport", ["passportId"])
    .index("by_status_and_expiresAt", ["status", "expiresAt"]),

  // A grant is the approved policy behind a slice: who it is for, what it
  // covers, which connection backs each app, and when it ends.
  grants: defineTable({
    passportId: v.id("passports"),
    userId: v.id("users"),
    agent: v.string(),
    apps: v.array(appValidator),
    bindings: v.array(grantBindingValidator),
    expiresAt: v.number(),
  }).index("by_passport", ["passportId"]),

  // Access requests cover two kinds:
  // - onboarding: agent-initiated grant request before any slice exists.
  //   Approve creates the slice; claim returns sliceToken/sliceSecret once.
  // - mint: operator approval for a short-lived credential on an existing slice.
  accessRequests: defineTable({
    kind: accessRequestKindValidator,
    // Bound when a signed-in user opens the approval URL or decides.
    userId: v.optional(v.id("users")),
    // Set for mint immediately; set for onboarding on approve.
    sliceId: v.optional(v.id("slices")),
    // Onboarding fields
    agentName: v.optional(v.string()),
    apps: v.optional(v.array(appValidator)),
    ttlMs: v.optional(v.number()),
    reason: v.optional(v.string()),
    // Mint fields
    app: v.optional(appValidator),
    refresh: v.optional(v.boolean()),
    // Chat-safe public id used in BOARD_ORIGIN approval URLs.
    publicToken: v.string(),
    // Agent-only claim handle (hashed). Never put in chat or the approval URL.
    claimSecretHash: v.string(),
    // Onboarding: one-time slice secret ciphertext until claim.
    issuedSliceToken: v.optional(v.string()),
    issuedSliceSecretCipher: v.optional(v.string()),
    status: accessRequestStatusValidator,
    // Pending deadline or post-approve claim window.
    expiresAt: v.number(),
    decidedAt: v.optional(v.number()),
    claimedAt: v.optional(v.number()),
  })
    .index("by_public_token", ["publicToken"])
    .index("by_claim_secret_hash", ["claimSecretHash"])
    .index("by_slice_and_status", ["sliceId", "status"])
    .index("by_user_and_status", ["userId", "status"])
    .index("by_status_and_expiresAt", ["status", "expiresAt"]),

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
    scopes: v.optional(v.string()),
    tokenExpiresAt: v.optional(v.number()),
  })
    .index("by_user_provider_app_providerUserId", [
      "userId",
      "provider",
      "app",
      "providerUserId",
    ])
    .index("by_user", ["userId"]),

  oauthStates: defineTable({
    userId: v.id("users"),
    provider: providerValidator,
    app: appValidator,
    state: v.string(),
    returnTo: v.string(),
    expiresAt: v.number(),
  }).index("by_state", ["state"]),
});
