import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";
import { appValidator, providerForApp, providerValidator } from "../../domain/apps";
import { encryptToken } from "../../lib/tokenEncryption";

export const clearConnection = internalMutation({
  args: { userId: v.id("users"), app: appValidator, connectionId: v.id("connections") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("connections", args.connectionId);
    if (!row || row.userId !== args.userId || row.app !== args.app) return null;
    await ctx.db.delete("connections", row._id);
    return null;
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
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("connections")
      .withIndex("by_user_provider_app_providerUserId", (q) =>
        q.eq("userId", args.userId).eq("provider", args.provider).eq("app", args.app).eq("providerUserId", args.providerUserId),
      )
      .unique();
    if (args.provider !== providerForApp(args.app)) throw new Error("Provider/app mismatch");
    if (!existing) {
      const accounts = await ctx.db.query("connections")
        .withIndex("by_user_provider_app_providerUserId", (q) => q.eq("userId", args.userId).eq("provider", args.provider).eq("app", args.app))
        .take(100);
      if (accounts.length >= 100) throw new Error("Too many connected accounts for this app");
    }
    const accessToken = await encryptToken(args.accessToken);
    const refreshToken =
      args.refreshToken === undefined
        ? undefined
        : await encryptToken(args.refreshToken);
    const doc = {
      userId: args.userId,
      provider: args.provider,
      app: args.app,
      accessToken,
      login: args.login,
      providerUserId: args.providerUserId,
      refreshToken: refreshToken ?? existing?.refreshToken,
      tokenExpiresAt: args.tokenExpiresAt,
      scopes: undefined,
    };
    if (existing) await ctx.db.replace("connections", existing._id, doc);
    else await ctx.db.insert("connections", doc);
    return null;
  },
});

export const refreshConnection = internalMutation({
  args: {
    userId: v.id("users"), app: appValidator, connectionId: v.id("connections"),
    providerUserId: v.string(), accessToken: v.string(),
    refreshToken: v.optional(v.string()), tokenExpiresAt: v.optional(v.number()),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("connections", args.connectionId);
    if (!row || row.userId !== args.userId || row.app !== args.app || row.providerUserId !== args.providerUserId) return false;
    await ctx.db.patch("connections", row._id, {
      accessToken: await encryptToken(args.accessToken),
      refreshToken: args.refreshToken === undefined ? row.refreshToken : await encryptToken(args.refreshToken),
      tokenExpiresAt: args.tokenExpiresAt ?? row.tokenExpiresAt,
    });
    return true;
  },
});
