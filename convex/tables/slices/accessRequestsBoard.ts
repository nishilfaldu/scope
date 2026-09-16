import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";
import { authenticatedMutation, authenticatedQuery } from "../../functions";
import {
  appValidator,
  isAppId,
  providerForApp,
  type AppId,
} from "../../domain/apps";
import { encryptToken } from "../../lib/tokenEncryption";
import { randomSecret, sha256Hex } from "../../lib/secrets";
import { ensurePassport } from "../passports";

export const CLAIM_WINDOW_MS = 60 * 1000;

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

const boardRequest = v.object({
  _id: v.id("accessRequests"),
  _creationTime: v.number(),
  kind: requestKindValidator,
  publicToken: v.string(),
  sliceId: v.optional(v.id("slices")),
  sliceName: v.string(),
  sliceToken: v.optional(v.string()),
  agentName: v.optional(v.string()),
  apps: v.optional(v.array(appValidator)),
  ttlMs: v.optional(v.number()),
  reason: v.optional(v.string()),
  app: v.optional(appValidator),
  refresh: v.optional(v.boolean()),
  status: requestStatusValidator,
  expiresAt: v.number(),
  decidedAt: v.optional(v.number()),
  claimedAt: v.optional(v.number()),
});

export const expireDue = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const now = Date.now();
    let expired = 0;
    for (const status of ["pending", "approved"] as const) {
      const due = await ctx.db
        .query("accessRequests")
        .withIndex("by_status_and_expiresAt", (q) =>
          q.eq("status", status).lte("expiresAt", now),
        )
        .take(25);
      for (const request of due) {
        await ctx.db.patch("accessRequests", request._id, {
          status: "expired",
        });
        expired += 1;
      }
    }
    return expired;
  },
});

async function toBoardRequest(
  ctx: { db: any },
  request: any,
) {
  if (request.kind === "onboarding") {
    return {
      _id: request._id,
      _creationTime: request._creationTime,
      kind: "onboarding" as const,
      publicToken: request.publicToken,
      sliceId: request.sliceId,
      sliceName: request.agentName ?? "Agent request",
      sliceToken: request.issuedSliceToken,
      agentName: request.agentName,
      apps: request.apps,
      ttlMs: request.ttlMs,
      reason: request.reason,
      status: request.status,
      expiresAt: request.expiresAt,
      decidedAt: request.decidedAt,
      claimedAt: request.claimedAt,
    };
  }
  const slice = request.sliceId
    ? await ctx.db.get("slices", request.sliceId)
    : null;
  return {
    _id: request._id,
    _creationTime: request._creationTime,
    kind: "mint" as const,
    publicToken: request.publicToken,
    sliceId: request.sliceId,
    sliceName: slice?.name ?? "Unknown slice",
    sliceToken: slice?.token,
    app: request.app,
    refresh: request.refresh === true,
    status: request.status,
    expiresAt: request.expiresAt,
    decidedAt: request.decidedAt,
    claimedAt: request.claimedAt,
  };
}

export const listPending = authenticatedQuery({
  args: {},
  returns: v.array(boardRequest),
  handler: async (ctx) => {
    const { userId } = ctx;
    const pending = await ctx.db
      .query("accessRequests")
      .withIndex("by_user_and_status", (q) =>
        q.eq("userId", userId).eq("status", "pending"),
      )
      .collect();
    const now = Date.now();
    const live = pending.filter((request) => request.expiresAt > now);
    live.sort((a, b) => b._creationTime - a._creationTime);
    return await Promise.all(live.map((request) => toBoardRequest(ctx, request)));
  },
});

export const pendingCount = authenticatedQuery({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const { userId } = ctx;
    const pending = await ctx.db
      .query("accessRequests")
      .withIndex("by_user_and_status", (q) =>
        q.eq("userId", userId).eq("status", "pending"),
      )
      .collect();
    const now = Date.now();
    return pending.filter((request) => request.expiresAt > now).length;
  },
});

export const listForSlice = authenticatedQuery({
  args: { sliceId: v.string() },
  returns: v.array(boardRequest),
  handler: async (ctx, args) => {
    const { userId } = ctx;
    const id = ctx.db.normalizeId("slices", args.sliceId);
    if (!id) return [];
    const slice = await ctx.db.get("slices", id);
    if (!slice || slice.userId !== userId) return [];
    const all = [];
    for (const status of [
      "pending",
      "approved",
      "denied",
      "expired",
      "claimed",
    ] as const) {
      const rows = await ctx.db
        .query("accessRequests")
        .withIndex("by_slice_and_status", (q) =>
          q.eq("sliceId", id).eq("status", status),
        )
        .collect();
      all.push(...rows);
    }
    all.sort((a, b) => b._creationTime - a._creationTime);
    return await Promise.all(
      all.slice(0, 20).map((request) => toBoardRequest(ctx, request)),
    );
  },
});

export const getByPublicToken = authenticatedQuery({
  args: { publicToken: v.string() },
  returns: v.union(boardRequest, v.null()),
  handler: async (ctx, args) => {
    const request = await ctx.db
      .query("accessRequests")
      .withIndex("by_public_token", (q) => q.eq("publicToken", args.publicToken))
      .unique();
    if (!request) return null;
    if (request.userId && request.userId !== ctx.userId) {
      return null;
    }
    return await toBoardRequest(ctx, request);
  },
});

export const bindToViewer = authenticatedMutation({
  args: { publicToken: v.string() },
  returns: v.union(boardRequest, v.null()),
  handler: async (ctx, args) => {
    const { userId } = ctx;
    const request = await ctx.db
      .query("accessRequests")
      .withIndex("by_public_token", (q) => q.eq("publicToken", args.publicToken))
      .unique();
    if (!request) return null;
    if (request.userId && request.userId !== userId) {
      return null;
    }
    if (!request.userId) {
      await ctx.db.patch("accessRequests", request._id, { userId });
      const updated = await ctx.db.get("accessRequests", request._id);
      if (!updated) return null;
      return await toBoardRequest(ctx, updated);
    }
    return await toBoardRequest(ctx, request);
  },
});
