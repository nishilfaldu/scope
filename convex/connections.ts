import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  action,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import { revokeProviderGrant } from "./oauth";
import { PROVIDERS, providerValidator } from "./permissions";

const STATE_TTL_MS = 10 * 60 * 1000;

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

export const disconnect = action({
  args: { provider: providerValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const token = await ctx.runQuery(internal.connections.getAccessToken, {
      provider: args.provider,
    });
    if (token) {
      await revokeProviderGrant(args.provider, token);
    }
    await ctx.runMutation(internal.connections.clearConnection, {
      provider: args.provider,
    });
    return null;
  },
});

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

export const getAccessToken = internalQuery({
  args: { provider: providerValidator },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("connections")
      .withIndex("by_provider", (q) => q.eq("provider", args.provider))
      .unique();
    return row?.accessToken ?? null;
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

export const putOauthState = internalMutation({
  args: {
    provider: providerValidator,
    state: v.string(),
    returnTo: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("oauthStates", {
      provider: args.provider,
      state: args.state,
      returnTo: args.returnTo,
      expiresAt: Date.now() + STATE_TTL_MS,
    });
    return null;
  },
});

export const consumeOauthState = internalMutation({
  args: { state: v.string() },
  returns: v.union(
    v.object({ provider: providerValidator, returnTo: v.string() }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("oauthStates")
      .withIndex("by_state", (q) => q.eq("state", args.state))
      .unique();
    if (!row) {
      return null;
    }
    await ctx.db.delete("oauthStates", row._id);
    if (row.expiresAt <= Date.now()) {
      return null;
    }
    return { provider: row.provider, returnTo: row.returnTo };
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
