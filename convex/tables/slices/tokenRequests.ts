import { v } from "convex/values";
import { authenticatedMutation, authenticatedQuery } from "../../functions";
import { appValidator } from "../../domain/apps";
import {
  CLAIM_WINDOW_MS,
  effectiveRequestStatus,
  requestStatusValidator,
} from "../../domain/requests";
import { selectedConnection } from "../connections/helpers";
import { hasActiveAgentConnection } from "./helpers";

const tokenRequest = v.object({
  publicToken: v.string(),
  status: requestStatusValidator,
  sliceName: v.string(),
  app: appValidator,
  accountLogin: v.union(v.string(), v.null()),
  expiresAt: v.number(),
});

export const get = authenticatedQuery({
  args: { publicToken: v.string() },
  returns: v.union(tokenRequest, v.null()),
  handler: async (ctx, { publicToken }) => {
    const request = await ctx.db
      .query("tokenRequests")
      .withIndex("by_public_token", (q) => q.eq("publicToken", publicToken))
      .unique();
    if (!request) return null;
    const slice = await ctx.db.get("slices", request.sliceId);
    if (
      !slice ||
      slice.userId !== ctx.userId ||
      !(await hasActiveAgentConnection(ctx, slice))
    ) {
      return null;
    }
    const binding = await ctx.db.get("sliceBindings", request.bindingId);
    const connection =
      binding?.sliceId === slice._id && binding.app === request.app
        ? await selectedConnection(
            ctx,
            ctx.userId,
            request.app,
            binding.connectionId,
          )
        : null;
    return {
      publicToken,
      status: effectiveRequestStatus(request, Date.now()),
      sliceName: slice.name,
      app: request.app,
      accountLogin: connection?.login ?? null,
      expiresAt: request.expiresAt,
    };
  },
});

export const decide = authenticatedMutation({
  args: {
    publicToken: v.string(),
    decision: v.union(v.literal("approved"), v.literal("denied")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const request = await ctx.db
      .query("tokenRequests")
      .withIndex("by_public_token", (q) =>
        q.eq("publicToken", args.publicToken),
      )
      .unique();
    if (!request) throw new Error("Request unavailable");
    const slice = await ctx.db.get("slices", request.sliceId);
    if (
      !slice ||
      slice.userId !== ctx.userId ||
      !(await hasActiveAgentConnection(ctx, slice))
    ) {
      throw new Error("Request unavailable");
    }
    if (effectiveRequestStatus(request, Date.now()) !== "pending") {
      throw new Error("Request is no longer pending");
    }
    if (args.decision === "denied") {
      await ctx.db.patch("tokenRequests", request._id, {
        status: "denied",
      });
      return null;
    }
    const binding = await ctx.db.get("sliceBindings", request.bindingId);
    if (
      !binding ||
      binding.sliceId !== request.sliceId ||
      binding.app !== request.app ||
      !(await selectedConnection(
        ctx,
        ctx.userId,
        request.app,
        binding.connectionId,
      ))
    ) {
      throw new Error(
        "The requested account is no longer allowed on this slice",
      );
    }
    await ctx.db.patch("tokenRequests", request._id, {
      status: "approved",
      expiresAt: Date.now() + CLAIM_WINDOW_MS,
    });
    return null;
  },
});
