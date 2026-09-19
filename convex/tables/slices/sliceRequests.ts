import { v } from "convex/values";
import { authenticatedMutation, authenticatedQuery } from "../../functions";
import { appValidator } from "../../domain/apps";
import {
  CLAIM_WINDOW_MS,
  effectiveRequestStatus,
  requestStatusValidator,
} from "../../domain/requests";
import { encryptToken } from "../../lib/tokenEncryption";
import { createSlice, validatedBindings } from "./helpers";
import { activeConnectionForAgent } from "../agentConnections";

const sliceRequest = v.object({
  publicToken: v.string(),
  status: requestStatusValidator,
  agentName: v.string(),
  apps: v.array(appValidator),
  ttlMs: v.number(),
  reason: v.string(),
  expiresAt: v.number(),
});

export const get = authenticatedQuery({
  args: { publicToken: v.string() },
  returns: v.union(sliceRequest, v.null()),
  handler: async (ctx, { publicToken }) => {
    const request = await ctx.db
      .query("sliceRequests")
      .withIndex("by_public_token", (q) => q.eq("publicToken", publicToken))
      .unique();
    if (!request) return null;
    const connection = await activeConnectionForAgent(ctx, request.agentId);
    if (!connection || connection.userId !== ctx.userId) {
      return null;
    }
    return {
      publicToken,
      status: effectiveRequestStatus(request, Date.now()),
      agentName: connection.name,
      apps: request.apps,
      ttlMs: request.ttlMs,
      reason: request.reason,
      expiresAt: request.expiresAt,
    };
  },
});

export const decide = authenticatedMutation({
  args: {
    publicToken: v.string(),
    decision: v.union(v.literal("approved"), v.literal("denied")),
    bindings: v.optional(
      v.array(
        v.object({ app: appValidator, connectionId: v.id("connections") }),
      ),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const request = await ctx.db
      .query("sliceRequests")
      .withIndex("by_public_token", (q) =>
        q.eq("publicToken", args.publicToken),
      )
      .unique();
    if (!request) throw new Error("Request unavailable");
    if (effectiveRequestStatus(request, Date.now()) !== "pending") {
      throw new Error("Request is no longer pending");
    }
    const agentConnection = await activeConnectionForAgent(
      ctx,
      request.agentId,
    );
    if (!agentConnection || agentConnection.userId !== ctx.userId) {
      throw new Error("Agent connection has been revoked");
    }
    if (args.decision === "denied") {
      await ctx.db.patch("sliceRequests", request._id, {
        status: "denied",
        claimHandleCipher: "",
      });
      return null;
    }
    const bindings = await validatedBindings(
      ctx,
      ctx.userId,
      args.bindings,
      request.apps,
    );
    const created = await createSlice(ctx, {
      userId: ctx.userId,
      name: agentConnection.name,
      ttlMs: request.ttlMs,
      mintPolicy: "auto",
      bindings,
      agentId: request.agentId,
    });
    await ctx.db.patch("sliceRequests", request._id, {
      status: "approved",
      createdSliceId: created.id,
      issuedSliceSecretCipher: await encryptToken(created.sliceSecret),
      expiresAt: Date.now() + CLAIM_WINDOW_MS,
    });
    return null;
  },
});
