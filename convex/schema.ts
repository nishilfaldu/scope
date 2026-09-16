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
  // covers, and when it ends.
  grants: defineTable({
    passportId: v.id("passports"),
    userId: v.id("users"),
    agent: v.string(),
    apps: v.array(appValidator),
    expiresAt: v.number(),
  }).index("by_passport", ["passportId"]),

  // Operator approval queue for credential mint when mintPolicy is "approve".
  // Token is minted at claim time, not at approve.
  accessRequests: defineTable({
    sliceId: v.id("slices"),
    userId: v.id("users"),
    app: appValidator,
    refresh: v.boolean(),
    status: accessRequestStatusValidator,
    // Pending deadline (~5m) or post-approve claim window (~60s).
    expiresAt: v.number(),
    decidedAt: v.optional(v.number()),
    claimedAt: v.optional(v.number()),
  })
    .index("by_slice_and_status", ["sliceId", "status"])
    .index("by_user_and_status", ["userId", "status"])
    .index("by_status_and_expiresAt", ["status", "expiresAt"]),

  connections: defineTable({
    userId: v.id("users"),
    provider: providerValidator,
    accessToken: v.string(),
    login: v.string(),
    providerUserId: v.string(),
    refreshToken: v.optional(v.string()),
    tokenExpiresAt: v.optional(v.number()),
  }).index("by_user_and_provider", ["userId", "provider"]),

  oauthStates: defineTable({
    userId: v.id("users"),
    provider: providerValidator,
    state: v.string(),
    returnTo: v.string(),
    expiresAt: v.number(),
  }).index("by_state", ["state"]),
});
