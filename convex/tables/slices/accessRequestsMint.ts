import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";
import { appValidator } from "../../domain/apps";
import {
  APPROVAL_DENIED_ERROR, APPROVAL_EXPIRED_ERROR, APPROVAL_REQUIRED_ERROR,
  denyResultValidator, EXPIRED_ERROR, REVOKED_ERROR, UNAUTHORIZED_ERROR,
} from "../../lib/errors";
import { selectedConnection } from "../connections/helpers";
import { denyCreate, effectiveStatus, sliceBySecret } from "./helpers";
import { issuePublicPair } from "./onboardingAccess";

export const PENDING_TTL_MS = 5 * 60 * 1000;
export const MAX_PENDING_PER_SLICE = 5;

export const createPending = internalMutation({
  args: { sliceId: v.id("slices"), userId: v.id("users"), app: appValidator, bindingId: v.id("sliceBindings") },
  returns: v.union(
    v.object({
      ok: v.literal(true), requestId: v.id("accessRequests"), publicToken: v.string(),
      expiresAt: v.number(), status: v.literal("pending"),
      code: v.literal("APPROVAL_REQUIRED"), reason: v.string(),
    }),
    denyResultValidator,
  ),
  handler: async (ctx, args) => {
    const slice = await ctx.db.get("slices", args.sliceId);
    if (!slice || slice.userId !== args.userId || effectiveStatus(slice) !== "active") {
      return denyCreate(403, EXPIRED_ERROR, "EXPIRED");
    }
    const binding = await ctx.db.get("sliceBindings", args.bindingId);
    if (!binding || binding.sliceId !== slice._id || binding.app !== args.app ||
        !await selectedConnection(ctx, slice.userId, args.app, binding.connectionId)) {
      return denyCreate(403, "This account is not available to this slice", "APP_UNAVAILABLE");
    }
    const pending = await ctx.db.query("accessRequests")
      .withIndex("by_slice_status_expiresAt", (q) =>
        q.eq("sliceId", args.sliceId).eq("status", "pending")
          .gt("expiresAt", Date.now())).take(MAX_PENDING_PER_SLICE);
    if (pending.length >= MAX_PENDING_PER_SLICE) {
      return denyCreate(429, "Too many pending credential requests for this slice", "INVALID_REQUEST");
    }
    const { publicToken, claimSecretHash } = await issuePublicPair();
    const expiresAt = Date.now() + PENDING_TTL_MS;
    const requestId = await ctx.db.insert("accessRequests", {
      kind: "mint", sliceId: args.sliceId, userId: args.userId, app: args.app, bindingId: args.bindingId,
      publicToken, claimSecretHash, status: "pending", expiresAt,
    });
    return {
      ok: true as const, requestId, publicToken, expiresAt,
      status: "pending" as const, code: "APPROVAL_REQUIRED" as const,
      reason: APPROVAL_REQUIRED_ERROR,
    };
  },
});

export const resolveClaim = internalMutation({
  args: { sliceToken: v.string(), sliceSecret: v.string(), requestId: v.id("accessRequests") },
  returns: v.union(
    v.object({
      ok: v.literal(true), kind: v.literal("pending"), requestId: v.id("accessRequests"),
      status: v.literal("pending"), expiresAt: v.number(), app: appValidator,
    }),
    v.object({
      ok: v.literal(true), kind: v.literal("mint"), requestId: v.id("accessRequests"),
      sliceId: v.id("slices"), userId: v.id("users"),
      app: appValidator, bindingId: v.id("sliceBindings"), connectionId: v.id("connections"),
    }),
    denyResultValidator,
  ),
  handler: async (ctx, args) => {
    const slice = await sliceBySecret(ctx, args);
    if (!slice) return denyCreate(401, UNAUTHORIZED_ERROR, "UNAUTHORIZED");
    const request = await ctx.db.get("accessRequests", args.requestId);
    if (!request || request.kind !== "mint" || request.sliceId !== slice._id) {
      return denyCreate(404, "Unknown credential request", "INVALID_REQUEST");
    }
    if (request.status === "denied") return denyCreate(403, APPROVAL_DENIED_ERROR, "APPROVAL_DENIED");
    if (request.status === "claimed" || request.expiresAt <= Date.now()) {
      return denyCreate(403, APPROVAL_EXPIRED_ERROR, "APPROVAL_EXPIRED");
    }
    if (request.status === "pending") {
      return {
        ok: true as const, kind: "pending" as const, requestId: request._id,
        status: "pending" as const, expiresAt: request.expiresAt, app: request.app,
      };
    }
    const status = effectiveStatus(slice);
    if (status === "revoked") return denyCreate(403, REVOKED_ERROR, "REVOKED");
    if (status === "expired") return denyCreate(403, EXPIRED_ERROR, "EXPIRED");
    const binding = request.bindingId ? await ctx.db.get("sliceBindings", request.bindingId) : null;
    const connection = binding
      && binding.sliceId === slice._id && binding.app === request.app
      ? await selectedConnection(ctx, slice.userId, request.app, binding.connectionId) : null;
    if (!connection) return denyCreate(403, "This app is not available to this slice", "APP_UNAVAILABLE");
    return {
      ok: true as const, kind: "mint" as const, requestId: request._id,
      sliceId: slice._id, userId: slice.userId, app: request.app,
      bindingId: binding!._id, connectionId: connection._id,
    };
  },
});
