import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";
import {
  appValidator,
  providerForApp,
  providerValidator,
} from "../../domain/apps";
import {
  APPROVAL_DENIED_ERROR,
  APPROVAL_EXPIRED_ERROR,
  APPROVAL_REQUIRED_ERROR,
  denyResultValidator,
  EXPIRED_ERROR,
  REVOKED_ERROR,
  UNAUTHORIZED_ERROR,
} from "../../lib/errors";
import { hashesEqual, sha256Hex } from "../../lib/secrets";
import { denyCreate } from "./helpers";
import { issuePublicPair } from "./onboardingAccess";

export const PENDING_TTL_MS = 5 * 60 * 1000;
export const MAX_PENDING_PER_SLICE = 5;

export const createPending = internalMutation({
  args: {
    sliceId: v.id("slices"),
    userId: v.id("users"),
    app: appValidator,
    refresh: v.boolean(),
  },
  returns: v.union(
    v.object({
      ok: v.literal(true),
      requestId: v.id("accessRequests"),
      publicToken: v.string(),
      expiresAt: v.number(),
      status: v.literal("pending"),
      code: v.literal("APPROVAL_REQUIRED"),
      reason: v.string(),
    }),
    denyResultValidator,
  ),
  handler: async (ctx, args) => {
    const pending = await ctx.db
      .query("accessRequests")
      .withIndex("by_slice_and_status", (q) =>
        q.eq("sliceId", args.sliceId).eq("status", "pending"),
      )
      .collect();
    if (pending.length >= MAX_PENDING_PER_SLICE) {
      return denyCreate(
        429,
        "Too many pending credential requests for this slice",
        "INVALID_REQUEST",
      );
    }
    const now = Date.now();
    const expiresAt = now + PENDING_TTL_MS;
    const { publicToken, claimSecretHash } = await issuePublicPair();
    const requestId = await ctx.db.insert("accessRequests", {
      kind: "mint",
      sliceId: args.sliceId,
      userId: args.userId,
      app: args.app,
      refresh: args.refresh,
      publicToken,
      claimSecretHash,
      status: "pending",
      expiresAt,
    });
    return {
      ok: true as const,
      requestId,
      publicToken,
      expiresAt,
      status: "pending" as const,
      code: "APPROVAL_REQUIRED" as const,
      reason: APPROVAL_REQUIRED_ERROR,
    };
  },
});

export const resolveClaim = internalMutation({
  args: {
    sliceToken: v.string(),
    sliceSecret: v.string(),
    requestId: v.id("accessRequests"),
  },
  returns: v.union(
    v.object({
      ok: v.literal(true),
      kind: v.literal("pending"),
      requestId: v.id("accessRequests"),
      status: v.literal("pending"),
      expiresAt: v.number(),
      app: appValidator,
    }),
    v.object({
      ok: v.literal(true),
      kind: v.literal("mint"),
      requestId: v.id("accessRequests"),
      sliceId: v.id("slices"),
      userId: v.id("users"),
      app: appValidator,
      provider: providerValidator,
      refresh: v.boolean(),
    }),
    denyResultValidator,
  ),
  handler: async (ctx, args) => {
    const now = Date.now();
    const slice = await ctx.db
      .query("slices")
      .withIndex("by_token", (q) => q.eq("token", args.sliceToken))
      .unique();
    if (!slice) {
      return denyCreate(401, UNAUTHORIZED_ERROR, "UNAUTHORIZED");
    }
    const secretHash = await sha256Hex(args.sliceSecret);
    if (!hashesEqual(secretHash, slice.secretHash)) {
      return denyCreate(401, UNAUTHORIZED_ERROR, "UNAUTHORIZED");
    }

    const request = await ctx.db.get("accessRequests", args.requestId);
    if (
      !request ||
      request.kind !== "mint" ||
      request.sliceId !== slice._id ||
      !request.publicToken ||
      !request.claimSecretHash
    ) {
      return denyCreate(404, "Unknown credential request", "INVALID_REQUEST");
    }

    if (request.status === "pending" && request.expiresAt <= now) {
      await ctx.db.patch("accessRequests", request._id, { status: "expired" });
      return denyCreate(403, APPROVAL_EXPIRED_ERROR, "APPROVAL_EXPIRED");
    }
    if (request.status === "approved" && request.expiresAt <= now) {
      await ctx.db.patch("accessRequests", request._id, { status: "expired" });
      return denyCreate(403, APPROVAL_EXPIRED_ERROR, "APPROVAL_EXPIRED");
    }
    if (request.status === "denied") {
      return denyCreate(403, APPROVAL_DENIED_ERROR, "APPROVAL_DENIED");
    }
    if (request.status === "expired") {
      return denyCreate(403, APPROVAL_EXPIRED_ERROR, "APPROVAL_EXPIRED");
    }
    if (request.status === "claimed") {
      return denyCreate(403, APPROVAL_EXPIRED_ERROR, "APPROVAL_EXPIRED");
    }
    if (request.status === "pending") {
      if (!request.app) {
        return denyCreate(500, "Mint request missing app", "INVALID_REQUEST");
      }
      return {
        ok: true as const,
        kind: "pending" as const,
        requestId: request._id,
        status: "pending" as const,
        expiresAt: request.expiresAt,
        app: request.app,
      };
    }

    if (slice.status === "revoked") {
      return denyCreate(403, REVOKED_ERROR, "REVOKED");
    }
    if (slice.status === "expired" || slice.expiresAt <= now) {
      return denyCreate(403, EXPIRED_ERROR, "EXPIRED");
    }
    if (!request.app) {
      return denyCreate(500, "Mint request missing app", "INVALID_REQUEST");
    }
    const grant = await ctx.db.get("grants", slice.grantId);
    if (!grant || !grant.apps.includes(request.app)) {
      return denyCreate(
        403,
        "This app is not available to this slice",
        "APP_UNAVAILABLE",
      );
    }
    const provider = providerForApp(request.app);
    const connection = await ctx.db
      .query("connections")
      .withIndex("by_user_and_provider", (q) =>
        q.eq("userId", slice.userId).eq("provider", provider),
      )
      .unique();
    if (!connection) {
      return denyCreate(
        403,
        "This app is not available to this slice",
        "APP_UNAVAILABLE",
      );
    }

    await ctx.db.patch("accessRequests", request._id, {
      status: "claimed",
      claimedAt: now,
    });

    return {
      ok: true as const,
      kind: "mint" as const,
      requestId: request._id,
      sliceId: slice._id,
      userId: slice.userId,
      app: request.app,
      provider,
      refresh: request.refresh === true,
    };
  },
});
