import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";
import {
  appValidator,
  providerForApp,
  providerValidator,
} from "../../domain/apps";
import { encryptToken } from "../../lib/tokenEncryption";

export const clearConnection = internalMutation({
  args: {
    userId: v.id("users"),
    app: appValidator,
    connectionId: v.id("connections"),
  },
  returns: v.union(
    v.object({ storedAccessToken: v.string(), revokeUpstream: v.boolean() }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("connections", args.connectionId);
    if (!row || row.userId !== args.userId || row.app !== args.app) return null;
    let revokeUpstream = true;
    if (providerForApp(row.app) === "google") {
      for (const app of [
        "gmail",
        "calendar",
        "drive",
        "docs",
        "sheets",
      ] as const) {
        const others = await ctx.db
          .query("connections")
          .withIndex("by_user_app_providerUserId", (q) =>
            q
              .eq("userId", args.userId)
              .eq("app", app)
              .eq("providerUserId", row.providerUserId),
          )
          .take(2);
        if (others.some((other) => other._id !== row._id)) {
          revokeUpstream = false;
          break;
        }
      }
    }
    await ctx.db.delete("connections", row._id);
    return { storedAccessToken: row.accessToken, revokeUpstream };
  },
});

export const saveConnection = internalMutation({
  args: {
    userId: v.id("users"),
    provider: providerValidator,
    app: appValidator,
    accessToken: v.string(),
    login: v.string(),
    providerUserId: v.string(),
    refreshToken: v.optional(v.string()),
    tokenExpiresAt: v.optional(v.number()),
    grantedScopes: v.optional(v.array(v.string())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!args.providerUserId.trim())
      throw new Error("Provider account ID is required");
    const existing = await ctx.db
      .query("connections")
      .withIndex("by_user_app_providerUserId", (q) =>
        q
          .eq("userId", args.userId)
          .eq("app", args.app)
          .eq("providerUserId", args.providerUserId),
      )
      .unique();
    if (args.provider !== providerForApp(args.app))
      throw new Error("Provider/app mismatch");
    const accessToken = await encryptToken(args.accessToken);
    const refreshToken =
      args.refreshToken === undefined
        ? undefined
        : await encryptToken(args.refreshToken);
    const doc = {
      userId: args.userId,
      app: args.app,
      accessToken,
      login: args.login,
      providerUserId: args.providerUserId,
      refreshToken: refreshToken ?? existing?.refreshToken,
      tokenExpiresAt: args.tokenExpiresAt,
      grantedScopes: args.grantedScopes,
      grantVersion: (existing?.grantVersion ?? 0) + 1,
    };
    if (existing) await ctx.db.replace("connections", existing._id, doc);
    else await ctx.db.insert("connections", doc);
    return null;
  },
});

export const beginRefresh = internalMutation({
  args: {
    userId: v.id("users"),
    app: appValidator,
    connectionId: v.id("connections"),
    grantVersion: v.number(),
    lease: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("connections", args.connectionId);
    if (
      !row ||
      row.userId !== args.userId ||
      row.app !== args.app ||
      row.grantVersion !== args.grantVersion ||
      (row.refreshLease && (row.refreshLeaseExpiresAt ?? 0) > Date.now())
    )
      return false;
    await ctx.db.patch("connections", row._id, {
      refreshLease: args.lease,
      refreshLeaseExpiresAt: Date.now() + 120_000,
    });
    return true;
  },
});

export const releaseRefresh = internalMutation({
  args: { connectionId: v.id("connections"), lease: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("connections", args.connectionId);
    if (row?.refreshLease === args.lease) {
      await ctx.db.patch("connections", row._id, {
        refreshLease: undefined,
        refreshLeaseExpiresAt: undefined,
      });
    }
    return null;
  },
});

export const refreshConnection = internalMutation({
  args: {
    userId: v.id("users"),
    app: appValidator,
    connectionId: v.id("connections"),
    providerUserId: v.string(),
    accessToken: v.string(),
    refreshToken: v.optional(v.string()),
    tokenExpiresAt: v.optional(v.number()),
    grantedScopes: v.optional(v.array(v.string())),
    grantVersion: v.number(),
    lease: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("connections", args.connectionId);
    if (
      !row ||
      row.userId !== args.userId ||
      row.app !== args.app ||
      row.providerUserId !== args.providerUserId ||
      row.grantVersion !== args.grantVersion ||
      row.refreshLease !== args.lease ||
      (row.refreshLeaseExpiresAt ?? 0) <= Date.now()
    )
      return false;
    await ctx.db.patch("connections", row._id, {
      accessToken: await encryptToken(args.accessToken),
      refreshToken:
        args.refreshToken === undefined
          ? row.refreshToken
          : await encryptToken(args.refreshToken),
      tokenExpiresAt: args.tokenExpiresAt ?? row.tokenExpiresAt,
      grantedScopes: args.grantedScopes ?? row.grantedScopes,
      grantVersion: row.grantVersion + 1,
      refreshLease: undefined,
      refreshLeaseExpiresAt: undefined,
    });
    return true;
  },
});
