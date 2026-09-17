import { v } from "convex/values";
import { internalQuery } from "../../_generated/server";
import { authenticatedQuery } from "../../functions";
import { appValidator, ALL_APPS, providerForApp, providerValidator } from "../../domain/apps";
import { decryptToken } from "../../lib/tokenEncryption";
import { connectionsForApp, selectedConnection } from "./helpers";

const connectionValidator = v.object({
  accessToken: v.string(), login: v.string(), providerUserId: v.string(),
  refreshToken: v.union(v.string(), v.null()), tokenExpiresAt: v.union(v.number(), v.null()),
});

export const listStatuses = authenticatedQuery({
  args: {},
  returns: v.array(v.object({
    app: appValidator, provider: providerValidator, connected: v.boolean(),
    accounts: v.array(v.object({ id: v.id("connections"), login: v.string(), providerUserId: v.string() })),
  })),
  handler: async (ctx) => await Promise.all(ALL_APPS.map(async (app) => {
    const accounts = await connectionsForApp(ctx, ctx.userId, app);
    return { app, provider: providerForApp(app),
      connected: accounts.length > 0,
      accounts: accounts.map((row) => ({ id: row._id, login: row.login, providerUserId: row.providerUserId })) };
  })),
});

export const getConnection = internalQuery({
  args: { userId: v.id("users"), app: appValidator, connectionId: v.id("connections") },
  returns: v.union(connectionValidator, v.null()),
  handler: async (ctx, args) => {
    const row = await selectedConnection(ctx, args.userId, args.app, args.connectionId);
    if (!row) return null;
    return { accessToken: await decryptToken(row.accessToken), login: row.login,
      providerUserId: row.providerUserId,
      refreshToken: row.refreshToken === undefined ? null : await decryptToken(row.refreshToken),
      tokenExpiresAt: row.tokenExpiresAt ?? null };
  },
});

export const hasOtherGoogleApps = internalQuery({
  args: { userId: v.id("users"), providerUserId: v.string(), exceptId: v.id("connections") },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    for (const app of ["gmail", "calendar", "drive", "docs", "sheets"] as const) {
      const rows = await ctx.db.query("connections")
        .withIndex("by_user_provider_app_providerUserId", (q) => q.eq("userId", args.userId).eq("provider", "google").eq("app", app).eq("providerUserId", args.providerUserId))
        .take(2);
      if (rows.some((row) => row._id !== args.exceptId)) return true;
    }
    return false;
  },
});
