import { v } from "convex/values";

import { query } from "../../_generated/server";
import { appValidator } from "../../domain/apps";
import { requestKindValidator, requestStatusValidator, effectiveRequestStatus } from "../../domain/requests";

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
      status: effectiveRequestStatus(request, Date.now()),
      agentName: request.kind === "onboarding" ? request.agentName : undefined,
      apps: request.kind === "onboarding" ? request.apps : undefined,
      app: request.kind === "mint" ? request.app : undefined,
      reason: request.kind === "onboarding" ? request.reason : undefined,
      expiresAt: request.expiresAt,
      ttlMs: request.kind === "onboarding" ? request.ttlMs : undefined,
    };
  },
});
