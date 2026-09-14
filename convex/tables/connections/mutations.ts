import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";
import { providerValidator } from "../../domain/apps";

export const clearConnection = internalMutation({
  args: { provider: providerValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("connections")
      .withIndex("by_provider", (q) => q.eq("provider", args.provider))
      .unique();
    if (row) {
      await ctx.db.delete("connections", row._id);
    }
    return null;
  },
});

export const saveConnection = internalMutation({
  args: {
    provider: providerValidator,
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
      .withIndex("by_provider", (q) => q.eq("provider", args.provider))
      .unique();
    const doc = {
      provider: args.provider,
      accessToken: args.accessToken,
      login: args.login,
      providerUserId: args.providerUserId,
      refreshToken: args.refreshToken,
      tokenExpiresAt: args.tokenExpiresAt,
    };
    if (existing) {
      await ctx.db.replace("connections", existing._id, doc);
    } else {
      await ctx.db.insert("connections", doc);
    }
    return null;
  },
});
