import { v } from "convex/values";

import { query } from "../../_generated/server";
import { appValidator } from "../../domain/apps";

const requestStatusValidator = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("denied"),
  v.literal("expired"),
  v.literal("claimed"),
);

const requestKindValidator = v.union(
  v.literal("onboarding"),
  v.literal("mint"),
);

/**
 * Unsigned preview for the Link-style approval gate.
 * Safe fields only — no claim handles, slice secrets, or user ids.
 */
export const publicSummary = query({
  args: { publicToken: v.string() },
  returns: v.union(
    v.object({
      kind: requestKindValidator,
      status: requestStatusValidator,
      agentName: v.optional(v.string()),
      apps: v.optional(v.array(appValidator)),
      app: v.optional(appValidator),
      reason: v.optional(v.string()),
      expiresAt: v.number(),
      ttlMs: v.optional(v.number()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const request = await ctx.db
      .query("accessRequests")
      .withIndex("by_public_token", (q) => q.eq("publicToken", args.publicToken))
      .unique();
    if (!request) return null;
    return {
      kind: request.kind,
      status: request.status,
      agentName: request.agentName,
      apps: request.apps,
      app: request.app,
      reason: request.reason,
      expiresAt: request.expiresAt,
      ttlMs: request.ttlMs,
    };
  },
});
