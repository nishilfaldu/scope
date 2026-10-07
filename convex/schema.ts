import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const approvalStatus = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("denied"),
  v.literal("ended"),
  v.literal("expired"),
);

export default defineSchema({
  agents: defineTable({
    ownerId: v.string(),
    name: v.string(),
    tokenHash: v.string(),
    lastUsedAt: v.optional(v.number()),
  })
    .index("by_ownerId", ["ownerId"])
    .index("by_tokenHash", ["tokenHash"]),

  accounts: defineTable({
    ownerId: v.string(),
    providerId: v.string(),
    connectorId: v.string(),
    installationId: v.optional(v.string()),
    label: v.string(),
  }).index("by_ownerId_and_providerId", ["ownerId", "providerId"]),

  approvals: defineTable({
    ownerId: v.string(),
    agentId: v.id("agents"),
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
    .index("by_agentId_and_status_and_providerId", [
      "agentId",
      "status",
      "providerId",
    ])
    .index("by_accountId_and_status", ["accountId", "status"]),

  pushSubscriptions: defineTable({
    ownerId: v.string(),
    endpoint: v.string(),
    p256dh: v.string(),
    auth: v.string(),
  }).index("by_ownerId", ["ownerId"]),
});
