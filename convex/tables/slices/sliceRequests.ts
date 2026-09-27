import { v } from "convex/values";
import { authenticatedMutation, authenticatedQuery } from "../../functions";
import { appValidator } from "../../domain/apps";
import { requestStatusValidator } from "../../domain/requests";
import { encryptToken } from "../../lib/tokenEncryption";
import { createSlice, validatedBindings } from "./helpers";
import { internal } from "../../_generated/api";
import {
  activeConnectionForAgent,
  agentAccessRevokedAt,
} from "../agentConnections";
import { sliceHandoff } from "../../domain/handoff";

const sliceRequest = v.object({
  publicToken: v.string(),
  status: requestStatusValidator,
  agentName: v.string(),
  apps: v.array(appValidator),
  ttlMs: v.number(),
  reason: v.string(),
  approvalDeadlineAt: v.number(),
  pickupDeadlineAt: v.optional(v.number()),
  ackDeadlineAt: v.optional(v.number()),
  handoffStatus: v.string(),
  sliceExpiresAt: v.optional(v.number()),
  resourceStatus: v.optional(
    v.union(
      v.literal("staged"),
      v.literal("active"),
      v.literal("revoked"),
      v.literal("expired"),
    ),
  ),
  reasonCode: v.optional(v.string()),
});

export const SLICE_PICKUP_MS = 5 * 60 * 1000;

export const get = authenticatedQuery({
  args: { publicToken: v.string(), now: v.optional(v.number()) },
  returns: v.union(sliceRequest, v.null()),
  handler: async (ctx, { publicToken, now }) => {
    const request = await ctx.db
      .query("sliceRequests")
      .withIndex("by_public_token", (q) => q.eq("publicToken", publicToken))
      .unique();
    if (!request) return null;
    if (request.userId !== ctx.userId) {
      return null;
    }
    const connection = await activeConnectionForAgent(ctx, request.agentId);
    const slice = request.createdSliceId
      ? await ctx.db.get("slices", request.createdSliceId)
      : null;
    const { resourceStatus, handoffStatus, reasonCode } = sliceHandoff(
      request,
      slice,
      !!connection,
      now ?? Date.now(),
      connection ? undefined : await agentAccessRevokedAt(ctx, request.agentId),
    );
    return {
      publicToken,
      status: request.status,
      agentName: connection?.name ?? "Agent",
      apps: request.apps,
      ttlMs: request.ttlMs,
      reason: request.reason,
      approvalDeadlineAt: request.approvalDeadlineAt,
      pickupDeadlineAt: request.pickupDeadlineAt,
      ackDeadlineAt: request.ackDeadlineAt,
      handoffStatus,
      sliceExpiresAt: slice?.expiresAt,
      resourceStatus,
      reasonCode,
    };
  },
});

export const decide = authenticatedMutation({
  args: {
    publicToken: v.string(),
    decision: v.union(v.literal("approved"), v.literal("denied")),
    mintPolicy: v.optional(v.union(v.literal("auto"), v.literal("approve"))),
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
    if (
      request.status !== "pending" ||
      request.terminalReason ||
      request.approvalDeadlineAt <= Date.now()
    ) {
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
      mintPolicy: args.mintPolicy ?? "auto",
      bindings,
      agentId: request.agentId,
      initialStatus: "staged",
    });
    const pickupDeadlineAt = Date.now() + SLICE_PICKUP_MS;
    await ctx.db.patch("sliceRequests", request._id, {
      status: "approved",
      createdSliceId: created.id,
      issuedSliceSecretCipher: await encryptToken(created.sliceSecret),
      pickupDeadlineAt,
    });
    await ctx.scheduler.runAt(
      pickupDeadlineAt,
      internal.tables.slices.sliceRequestExpiry.clearClaimSecret,
      { requestId: request._id },
    );
    return null;
  },
});
