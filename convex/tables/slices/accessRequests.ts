import { v } from "convex/values";
import type { Doc } from "../../_generated/dataModel";
import { type QueryCtx } from "../../_generated/server";
import { authenticatedMutation, authenticatedQuery } from "../../functions";
import { appValidator } from "../../domain/apps";
import { requestStatusValidator, requestKindValidator, effectiveRequestStatus } from "../../domain/requests";
import { encryptToken } from "../../lib/tokenEncryption";
import { internal } from "../../_generated/api";
import { bindingFor, createSlice, validatedBindings } from "./helpers";

export const CLAIM_WINDOW_MS = 60 * 1000;

const boardRequest = v.object({
  _id: v.id("accessRequests"), _creationTime: v.number(),
  kind: requestKindValidator, publicToken: v.string(),
  sliceId: v.optional(v.id("slices")), sliceName: v.string(),
  sliceToken: v.optional(v.string()), agentName: v.optional(v.string()),
  apps: v.optional(v.array(appValidator)), ttlMs: v.optional(v.number()),
  reason: v.optional(v.string()), app: v.optional(appValidator),
  accountLogin: v.optional(v.string()),
  status: requestStatusValidator, expiresAt: v.number(),
  decidedAt: v.optional(v.number()), claimedAt: v.optional(v.number()),
});

async function toBoardRequest(ctx: Pick<QueryCtx, "db">, request: Doc<"accessRequests">) {
  const status = effectiveRequestStatus(request, Date.now());
  if (request.kind === "onboarding") return {
    _id: request._id, _creationTime: request._creationTime,
    kind: "onboarding" as const, publicToken: request.publicToken,
    sliceId: request.sliceId, sliceName: request.agentName ?? "Agent request",
    sliceToken: request.issuedSliceToken, agentName: request.agentName,
    apps: request.apps, ttlMs: request.ttlMs, reason: request.reason,
    status, expiresAt: request.expiresAt,
    decidedAt: request.decidedAt, claimedAt: request.claimedAt,
  };
  const slice = request.sliceId ? await ctx.db.get("slices", request.sliceId) : null;
  const binding = slice ? await bindingFor(ctx, slice._id, request.app) : null;
  const connection = binding ? await ctx.db.get("connections", binding.connectionId) : null;
  return {
    _id: request._id, _creationTime: request._creationTime,
    kind: "mint" as const, publicToken: request.publicToken,
    sliceId: request.sliceId, sliceName: slice?.name ?? "Unknown slice",
    sliceToken: slice?.token, app: request.app, accountLogin: connection?.login, status,
    expiresAt: request.expiresAt,
    decidedAt: request.decidedAt, claimedAt: request.claimedAt,
  };
}

export const listPending = authenticatedQuery({
  args: {}, returns: v.array(boardRequest),
  handler: async (ctx) => {
    const pending = await ctx.db.query("accessRequests")
      .withIndex("by_user_status_expiresAt", (q) =>
        q.eq("userId", ctx.userId).eq("status", "pending")
          .gt("expiresAt", Date.now())).take(100);
    return await Promise.all(pending
      .sort((a, b) => b._creationTime - a._creationTime)
      .map((request) => toBoardRequest(ctx, request)));
  },
});

export const pendingCount = authenticatedQuery({
  args: { now: v.number() }, returns: v.number(),
  handler: async (ctx, args) => {
    const pending = await ctx.db.query("accessRequests")
      .withIndex("by_user_status_expiresAt", (q) =>
        q.eq("userId", ctx.userId).eq("status", "pending")
          .gt("expiresAt", args.now)).take(100);
    return pending.length;
  },
});

export const listForSlice = authenticatedQuery({
  args: { sliceId: v.string() }, returns: v.array(boardRequest),
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("slices", args.sliceId);
    const slice = id ? await ctx.db.get("slices", id) : null;
    if (!slice || slice.userId !== ctx.userId) return [];
    const rows = await ctx.db.query("accessRequests")
      .withIndex("by_slice", (q) => q.eq("sliceId", slice._id))
      .order("desc").take(20);
    return await Promise.all(rows.map((request) => toBoardRequest(ctx, request)));
  },
});

export const getByPublicToken = authenticatedQuery({
  args: { publicToken: v.string() }, returns: v.union(boardRequest, v.null()),
  handler: async (ctx, args) => {
    const request = await ctx.db.query("accessRequests")
      .withIndex("by_public_token", (q) => q.eq("publicToken", args.publicToken)).unique();
    if (!request || request.userId && request.userId !== ctx.userId) return null;
    return await toBoardRequest(ctx, request);
  },
});

export const decide = authenticatedMutation({
  args: {
    requestId: v.id("accessRequests"),
    decision: v.union(v.literal("approved"), v.literal("denied")),
    bindings: v.optional(v.array(v.object({
      app: appValidator, connectionId: v.id("connections"),
    }))),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const request = await ctx.db.get("accessRequests", args.requestId);
    if (!request || request.userId && request.userId !== ctx.userId) {
      throw new Error("Request not found");
    }
    if (effectiveRequestStatus(request, Date.now()) === "expired") throw new Error("Request expired");
    if (request.status !== "pending") throw new Error("Request is no longer pending");
    const now = Date.now();
    if (args.decision === "denied") {
      await ctx.db.patch("accessRequests", request._id, {
        status: "denied", decidedAt: now, userId: ctx.userId,
        ...(request.kind === "onboarding" ? { claimHandleCipher: "" } : {}),
      });
      return null;
    }
    if (request.kind === "mint") {
      const slice = request.sliceId ? await ctx.db.get("slices", request.sliceId) : null;
      if (!slice || slice.userId !== ctx.userId) throw new Error("Slice not found");
      await ctx.db.patch("accessRequests", request._id, {
        status: "approved", decidedAt: now, userId: ctx.userId,
        expiresAt: now + CLAIM_WINDOW_MS,
      });
      return null;
    }
    const agentName = request.agentName?.trim();
    const apps = request.apps;
    const ttlMs = request.ttlMs;
    if (!agentName || !apps || !ttlMs) throw new Error("Onboarding request is incomplete");
    const bindings = await validatedBindings(ctx, ctx.userId, apps, args.bindings);
    const created = await createSlice(ctx, {
      userId: ctx.userId, name: agentName, ttlMs, mintPolicy: "auto", bindings,
    });
    await ctx.db.patch("accessRequests", request._id, {
      status: "approved", decidedAt: now, userId: ctx.userId,
      sliceId: created.id, issuedSliceToken: created.sliceToken,
      issuedSliceSecretCipher: await encryptToken(created.sliceSecret),
      expiresAt: now + CLAIM_WINDOW_MS,
    });
    await ctx.scheduler.runAfter(CLAIM_WINDOW_MS, internal.tables.slices.onboardingAccess.clearClaimSecret, { requestId: request._id });
    return null;
  },
});
