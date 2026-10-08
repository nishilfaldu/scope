import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const approvalStatus = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("denied"),
  v.literal("ended"),
  v.literal("expired"),
);

export const rule = v.union(
  v.literal("allow"),
  v.literal("ask"),
  v.literal("block"),
);

export default defineSchema({
  // One row per MCP app. Created on the app's first request.
  clients: defineTable({
    ownerId: v.string(),
    clientKey: v.string(),
    name: v.string(),
    revokedAt: v.optional(v.number()),
    lastUsedAt: v.optional(v.number()),
  }).index("by_ownerId_and_clientKey", ["ownerId", "clientKey"]),

  // Only rules that differ from the tool's default are stored.
  rules: defineTable({
    clientId: v.id("clients"),
    tool: v.string(),
    rule,
  }).index("by_clientId_and_tool", ["clientId", "tool"]),

  // Audit log. Never stores tool arguments or results.
  calls: defineTable({
    ownerId: v.string(),
    clientId: v.id("clients"),
    tool: v.string(),
    decision: v.union(
      v.literal("allowed"),
      v.literal("approved"),
      v.literal("blocked"),
      v.literal("denied"),
      v.literal("waiting"),
      v.literal("no-account"),
      v.literal("revoked"),
    ),
    outcome: v.optional(v.union(v.literal("ok"), v.literal("failed"))),
  })
    .index("by_ownerId", ["ownerId"])
    .index("by_clientId_and_tool", ["clientId", "tool"]),

  accounts: defineTable({
    ownerId: v.string(),
    providerId: v.string(),
    connectorId: v.string(),
    installationId: v.optional(v.string()),
    label: v.string(),
    // What the provider reported at connect time. Display only; it does not restrict the token.
    permissions: v.optional(
      v.object({ scopes: v.array(v.string()), checkedAt: v.number() }),
    ),
  }).index("by_ownerId_and_providerId", ["ownerId", "providerId"]),

  // An MCP app asks to run a tool.
  approvals: defineTable({
    ownerId: v.string(),
    clientId: v.id("clients"),
    tool: v.string(),
    // Approve once: valid for one call with exactly these arguments.
    once: v.optional(v.boolean()),
    argsHash: v.optional(v.string()),
    providerId: v.string(),
    accountId: v.optional(v.id("accounts")),
    reason: v.string(),
    status: approvalStatus,
    // Decision deadline while pending; end of the window once approved.
    expiresAt: v.number(),
    decidedAt: v.optional(v.number()),
    endedAt: v.optional(v.number()),
    collections: v.number(),
    lastCollectedAt: v.optional(v.number()),
  })
    // History needs creation-time order across every closed status.
    // eslint-disable-next-line @convex-dev/no-duplicate-indexes
    .index("by_ownerId", ["ownerId"])
    .index("by_ownerId_and_status", ["ownerId", "status"])
    .index("by_accountId_and_status", ["accountId", "status"])
    .index("by_clientId_and_status_and_tool", ["clientId", "status", "tool"]),

  pushSubscriptions: defineTable({
    ownerId: v.string(),
    endpoint: v.string(),
    p256dh: v.string(),
    auth: v.string(),
  }).index("by_ownerId", ["ownerId"]),
});
