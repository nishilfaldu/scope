import { v } from "convex/values";
import { internalQuery, query } from "../../_generated/server";
import { PROVIDERS, providerValidator } from "../../domain/apps";

const connectionValidator = v.object({
  accessToken: v.string(),
  login: v.string(),
  providerUserId: v.string(),
  refreshToken: v.union(v.string(), v.null()),
  tokenExpiresAt: v.union(v.number(), v.null()),
});

export const listStatuses = query({
  args: {},
  returns: v.array(
    v.object({
      provider: providerValidator,
      connected: v.boolean(),
      login: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx) => {
    const rows = [];
    for (const provider of PROVIDERS) {
      const row = await ctx.db
        .query("connections")
        .withIndex("by_provider", (q) => q.eq("provider", provider))
        .unique();
      rows.push({
        provider,
        connected: row !== null,
        login: row?.login ?? null,
      });
    }
    return rows;
  },
});

export const getConnection = internalQuery({
  args: { provider: providerValidator },
  returns: v.union(connectionValidator, v.null()),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("connections")
      .withIndex("by_provider", (q) => q.eq("provider", args.provider))
      .unique();
    if (!row) {
      return null;
    }
    return {
      accessToken: row.accessToken,
      login: row.login,
      providerUserId: row.providerUserId,
      refreshToken: row.refreshToken ?? null,
      tokenExpiresAt: row.tokenExpiresAt ?? null,
    };
  },
});
