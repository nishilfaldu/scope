import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  action,
  env,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";

const STATE_TTL_MS = 10 * 60 * 1000;

const connectionValidator = v.object({
  accessToken: v.string(),
  login: v.string(),
  providerUserId: v.string(),
  refreshToken: v.union(v.string(), v.null()),
  tokenExpiresAt: v.union(v.number(), v.null()),
});

export const status = query({
  args: { provider: v.string() },
  returns: v.union(
    v.object({ connected: v.literal(false) }),
    v.object({ connected: v.literal(true), login: v.string() }),
  ),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("connections")
      .withIndex("by_provider", (q) => q.eq("provider", args.provider))
      .unique();
    if (!row) {
      return { connected: false as const };
    }
    return { connected: true as const, login: row.login };
  },
});

export const disconnect = action({
  args: { provider: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.provider === "github") {
      const token = await ctx.runQuery(internal.connections.getAccessToken, {
        provider: args.provider,
      });
      const clientId = env.GITHUB_CLIENT_ID;
      const clientSecret = env.GITHUB_CLIENT_SECRET;
      if (token && clientId && clientSecret) {
        const basic = btoa(`${clientId}:${clientSecret}`);
        await fetch(
          `https://api.github.com/applications/${clientId}/grant`,
          {
            method: "DELETE",
            headers: {
              Accept: "application/vnd.github+json",
              Authorization: `Basic ${basic}`,
              "X-GitHub-Api-Version": "2022-11-28",
            },
            body: JSON.stringify({ access_token: token }),
          },
        );
      }
    }
    await ctx.runMutation(internal.connections.clearConnection, {
      provider: args.provider,
    });
    return null;
  },
});

export const clearConnection = internalMutation({
  args: { provider: v.string() },
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
  args: { provider: v.string() },
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
  args: { provider: v.string() },
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
    provider: v.string(),
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
  returns: v.union(v.string(), v.null()),
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
    return row.returnTo;
  },
});

export const saveConnection = internalMutation({
  args: {
    provider: v.string(),
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
