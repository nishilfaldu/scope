import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { appValidator, providerValidator } from "./domain/apps";
import { authTables } from "@convex-dev/auth/server";

const sliceStatusValidator = v.union(
  v.literal("active"),
  v.literal("revoked"),
  v.literal("expired"),
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

  connections: defineTable({
    provider: providerValidator,
    accessToken: v.string(),
    login: v.string(),
    providerUserId: v.string(),
    refreshToken: v.optional(v.string()),
    tokenExpiresAt: v.optional(v.number()),
  }).index("by_provider", ["provider"]),

  oauthStates: defineTable({
    provider: providerValidator,
    state: v.string(),
    returnTo: v.string(),
    expiresAt: v.number(),
  }).index("by_state", ["state"]),
});
