import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";
import { authenticatedMutation, authenticatedQuery } from "../../functions";
import { appValidator, providerForApp, providerValidator } from "../../domain/apps";
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

export const PENDING_TTL_MS = 5 * 60 * 1000;
export const CLAIM_WINDOW_MS = 60 * 1000;
export const MAX_PENDING_PER_SLICE = 5;

const requestStatusValidator = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("denied"),
  v.literal("expired"),
  v.literal("claimed"),
);

const boardRequest = v.object({
  _id: v.id("accessRequests"),
  _creationTime: v.number(),
  sliceId: v.id("slices"),
  sliceName: v.string(),
  sliceToken: v.string(),
  app: appValidator,
  refresh: v.boolean(),
  status: requestStatusValidator,
  expiresAt: v.number(),
  decidedAt: v.optional(v.number()),
  claimedAt: v.optional(v.number()),
});

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
    const requestId = await ctx.db.insert("accessRequests", {
      sliceId: args.sliceId,
      userId: args.userId,
      app: args.app,
      refresh: args.refresh,
      status: "pending",
      expiresAt,
    });
    return {
      ok: true as const,
      requestId,
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
    if (!request || request.sliceId !== slice._id) {
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
      return {
        ok: true as const,
        kind: "pending" as const,
        requestId: request._id,
        status: "pending" as const,
        expiresAt: request.expiresAt,
        app: request.app,
      };
    }

    // approved -> mint at claim time (single claim)
    if (slice.status === "revoked") {
      return denyCreate(403, REVOKED_ERROR, "REVOKED");
    }
    if (slice.status === "expired" || slice.expiresAt <= now) {
      return denyCreate(403, EXPIRED_ERROR, "EXPIRED");
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
      refresh: request.refresh,
    };
  },
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
    return await Promise.all(
      live.map(async (request) => {
        const slice = await ctx.db.get("slices", request.sliceId);
        return {
          _id: request._id,
          _creationTime: request._creationTime,
          sliceId: request.sliceId,
          sliceName: slice?.name ?? "Unknown slice",
          sliceToken: slice?.token ?? "",
          app: request.app,
          refresh: request.refresh,
          status: request.status,
          expiresAt: request.expiresAt,
          decidedAt: request.decidedAt,
          claimedAt: request.claimedAt,
        };
      }),
    );
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
    return all.slice(0, 20).map((request) => ({
      _id: request._id,
      _creationTime: request._creationTime,
      sliceId: request.sliceId,
      sliceName: slice.name,
      sliceToken: slice.token,
      app: request.app,
      refresh: request.refresh,
      status: request.status,
      expiresAt: request.expiresAt,
      decidedAt: request.decidedAt,
      claimedAt: request.claimedAt,
    }));
  },
});

export const decide = authenticatedMutation({
  args: {
    requestId: v.id("accessRequests"),
    decision: v.union(v.literal("approved"), v.literal("denied")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { userId } = ctx;
    const request = await ctx.db.get("accessRequests", args.requestId);
    if (!request || request.userId !== userId) {
      throw new Error("Request not found");
    }
    const now = Date.now();
    if (request.status === "pending" && request.expiresAt <= now) {
      await ctx.db.patch("accessRequests", request._id, { status: "expired" });
      throw new Error("Request expired");
    }
    if (request.status !== "pending") {
      throw new Error("Request is no longer pending");
    }
    if (args.decision === "denied") {
      await ctx.db.patch("accessRequests", request._id, {
        status: "denied",
        decidedAt: now,
      });
      return null;
    }
    await ctx.db.patch("accessRequests", request._id, {
      status: "approved",
      decidedAt: now,
      // Mint happens at claim; agent has a short window to claim once.
      expiresAt: now + CLAIM_WINDOW_MS,
    });
    return null;
  },
});
