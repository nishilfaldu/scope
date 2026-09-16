import { v } from "convex/values";
import type { Doc } from "../../_generated/dataModel";
import { internalMutation, type QueryCtx } from "../../_generated/server";
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

function isCompleteAccessRequest(request: Doc<"accessRequests">): boolean {
  return (
    request.kind !== undefined &&
    request.publicToken !== undefined &&
    request.claimSecretHash !== undefined
  );
}

export const expireDue = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const now = Date.now();
    let changed = 0;

    // Pre-prod: delete mint rows from before option A (missing kind/token/hash)
    // so they do not linger after the schema soft-landed those fields as optional.
    for (const status of [
      "pending",
      "approved",
      "denied",
      "expired",
      "claimed",
    ] as const) {
      const rows = await ctx.db
        .query("accessRequests")
        .withIndex("by_status_and_expiresAt", (q) => q.eq("status", status))
        .take(50);
      for (const request of rows) {
        if (!isCompleteAccessRequest(request)) {
          await ctx.db.delete("accessRequests", request._id);
          changed += 1;
        }
      }
    }

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
        changed += 1;
      }
    }
    return changed;
  },
});

async function toBoardRequest(
  ctx: Pick<QueryCtx, "db">,
  request: Doc<"accessRequests">,
) {
  if (!isCompleteAccessRequest(request)) {
    throw new Error("Incomplete access request row");
  }
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
    const live = pending.filter(
      (request) =>
        request.expiresAt > now && isCompleteAccessRequest(request),
    );
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
    return pending.filter(
      (request) =>
        request.expiresAt > now && isCompleteAccessRequest(request),
    ).length;
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
    const all: Doc<"accessRequests">[] = [];
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
      all.push(...rows.filter(isCompleteAccessRequest));
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
    if (!request || !isCompleteAccessRequest(request)) return null;
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
    if (!request || !isCompleteAccessRequest(request)) return null;
    if (request.userId && request.userId !== userId) {
      return null;
    }
    if (!request.userId) {
      await ctx.db.patch("accessRequests", request._id, { userId });
      const updated = await ctx.db.get("accessRequests", request._id);
      if (!updated || !isCompleteAccessRequest(updated)) return null;
      return await toBoardRequest(ctx, updated);
    }
    return await toBoardRequest(ctx, request);
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
    if (!request || !isCompleteAccessRequest(request)) {
      throw new Error("Request not found");
    }
    if (request.userId && request.userId !== userId) {
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

    // Bind unbound onboarding requests to the deciding user.
    if (!request.userId) {
      await ctx.db.patch("accessRequests", request._id, { userId });
    }

    if (args.decision === "denied") {
      await ctx.db.patch("accessRequests", request._id, {
        status: "denied",
        decidedAt: now,
        userId,
      });
      return null;
    }

    if (request.kind === "mint") {
      await ctx.db.patch("accessRequests", request._id, {
        status: "approved",
        decidedAt: now,
        userId,
        expiresAt: now + CLAIM_WINDOW_MS,
      });
      return null;
    }

    // Onboarding approve → create live slice; agent claims secrets over HTTPS.
    const agentName = (request.agentName ?? "agent").trim();
    const apps = (request.apps ?? []).filter((app): app is AppId => isAppId(app));
    const ttlMs = request.ttlMs ?? 0;
    if (apps.length === 0 || ttlMs <= 0) {
      throw new Error("Onboarding request is incomplete");
    }
    const connections = await ctx.db
      .query("connections")
      .withIndex("by_user_and_provider", (q) => q.eq("userId", userId))
      .collect();
    if (connections.length === 0) {
      throw new Error(
        "Connect an account at /connections before approving this request",
      );
    }
    const connectedProviders = new Set(
      connections.map((connection) => connection.provider),
    );
    const unavailable = apps.find(
      (app) => !connectedProviders.has(providerForApp(app)),
    );
    if (unavailable) {
      throw new Error(
        `Connect ${providerForApp(unavailable)} before allowing ${unavailable}`,
      );
    }

    const passportId = await ensurePassport(ctx, userId);
    const expiresAt = now + ttlMs;
    const grantId = await ctx.db.insert("grants", {
      passportId,
      userId,
      agent: agentName,
      apps,
      expiresAt,
    });
    const token = randomSecret("st_");
    const sliceSecret = randomSecret("ss_");
    const secretHash = await sha256Hex(sliceSecret);
    const sliceId = await ctx.db.insert("slices", {
      passportId,
      grantId,
      userId,
      name: agentName,
      token,
      secretHash,
      status: "active",
      expiresAt,
      // Onboarding already required Approve; subsequent mints use auto.
      mintPolicy: "auto",
    });
    const issuedSliceSecretCipher = await encryptToken(sliceSecret);
    await ctx.db.patch("accessRequests", request._id, {
      status: "approved",
      decidedAt: now,
      userId,
      sliceId,
      issuedSliceToken: token,
      issuedSliceSecretCipher,
      expiresAt: now + CLAIM_WINDOW_MS,
    });
    return null;
  },
});
