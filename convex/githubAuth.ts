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

const clientValidator = v.object({
  clientId: v.string(),
  clientSecret: v.string(),
  slug: v.union(v.string(), v.null()),
  pendingReturnTo: v.union(v.string(), v.null()),
});

const connectionValidator = v.object({
  accessToken: v.string(),
  login: v.string(),
  githubUserId: v.number(),
  refreshToken: v.union(v.string(), v.null()),
  tokenExpiresAt: v.union(v.number(), v.null()),
});

export const status = query({
  args: {},
  returns: v.union(
    v.object({ connected: v.literal(false) }),
    v.object({ connected: v.literal(true), login: v.string() }),
  ),
  handler: async (ctx) => {
    const row = await ctx.db
      .query("githubConnections")
      .withIndex("by_key", (q) => q.eq("key", "singleton"))
      .unique();
    if (!row) {
      return { connected: false as const };
    }
    return { connected: true as const, login: row.login };
  },
});

export const disconnect = action({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const token = await ctx.runQuery(internal.githubAuth.getAccessToken, {});
    const dbClient = await ctx.runQuery(internal.githubAuth.getClient, {});
    const envId = env.GITHUB_CLIENT_ID;
    const envSecret = env.GITHUB_CLIENT_SECRET;
    const client =
      envId && envSecret
        ? { clientId: envId, clientSecret: envSecret }
        : dbClient;
    if (token && client) {
      const basic = btoa(`${client.clientId}:${client.clientSecret}`);
      await fetch(
        `https://api.github.com/applications/${client.clientId}/grant`,
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
    await ctx.runMutation(internal.githubAuth.clearConnection, {});
    return null;
  },
});

export const clearConnection = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const row = await ctx.db
      .query("githubConnections")
      .withIndex("by_key", (q) => q.eq("key", "singleton"))
      .unique();
    if (row) {
      await ctx.db.delete("githubConnections", row._id);
    }
    return null;
  },
});

export const getAccessToken = internalQuery({
  args: {},
  returns: v.union(v.string(), v.null()),
  handler: async (ctx) => {
    const row = await ctx.db
      .query("githubConnections")
      .withIndex("by_key", (q) => q.eq("key", "singleton"))
      .unique();
    return row?.accessToken ?? null;
  },
});

export const getConnection = internalQuery({
  args: {},
  returns: v.union(connectionValidator, v.null()),
  handler: async (ctx) => {
    const row = await ctx.db
      .query("githubConnections")
      .withIndex("by_key", (q) => q.eq("key", "singleton"))
      .unique();
    if (!row) {
      return null;
    }
    return {
      accessToken: row.accessToken,
      login: row.login,
      githubUserId: row.githubUserId,
      refreshToken: row.refreshToken ?? null,
      tokenExpiresAt: row.tokenExpiresAt ?? null,
    };
  },
});

export const getClient = internalQuery({
  args: {},
  returns: v.union(clientValidator, v.null()),
  handler: async (ctx) => {
    const row = await ctx.db
      .query("githubAppCredentials")
      .withIndex("by_key", (q) => q.eq("key", "singleton"))
      .unique();
    if (!row) {
      return null;
    }
    return {
      clientId: row.clientId,
      clientSecret: row.clientSecret,
      slug: row.slug,
      pendingReturnTo: row.pendingReturnTo ?? null,
    };
  },
});

export const saveAppCredentials = internalMutation({
  args: {
    clientId: v.string(),
    clientSecret: v.string(),
    slug: v.string(),
    pendingReturnTo: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("githubAppCredentials")
      .withIndex("by_key", (q) => q.eq("key", "singleton"))
      .unique();
    const doc = {
      key: "singleton" as const,
      clientId: args.clientId,
      clientSecret: args.clientSecret,
      slug: args.slug,
      pendingReturnTo: args.pendingReturnTo,
    };
    if (existing) {
      await ctx.db.replace("githubAppCredentials", existing._id, doc);
    } else {
      await ctx.db.insert("githubAppCredentials", doc);
    }
    return null;
  },
});

export const consumePendingReturnTo = internalMutation({
  args: {},
  returns: v.union(v.string(), v.null()),
  handler: async (ctx) => {
    const row = await ctx.db
      .query("githubAppCredentials")
      .withIndex("by_key", (q) => q.eq("key", "singleton"))
      .unique();
    if (!row?.pendingReturnTo) {
      return null;
    }
    await ctx.db.replace("githubAppCredentials", row._id, {
      key: "singleton",
      clientId: row.clientId,
      clientSecret: row.clientSecret,
      slug: row.slug,
    });
    return row.pendingReturnTo;
  },
});

export const putOauthState = internalMutation({
  args: {
    state: v.string(),
    returnTo: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("githubOauthStates", {
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
      .query("githubOauthStates")
      .withIndex("by_state", (q) => q.eq("state", args.state))
      .unique();
    if (!row) {
      return null;
    }
    await ctx.db.delete("githubOauthStates", row._id);
    if (row.expiresAt <= Date.now()) {
      return null;
    }
    return row.returnTo;
  },
});

export const saveConnection = internalMutation({
  args: {
    accessToken: v.string(),
    login: v.string(),
    githubUserId: v.number(),
    refreshToken: v.optional(v.string()),
    tokenExpiresAt: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("githubConnections")
      .withIndex("by_key", (q) => q.eq("key", "singleton"))
      .unique();
    const doc = {
      key: "singleton" as const,
      accessToken: args.accessToken,
      login: args.login,
      githubUserId: args.githubUserId,
      refreshToken: args.refreshToken,
      tokenExpiresAt: args.tokenExpiresAt,
    };
    if (existing) {
      await ctx.db.replace("githubConnections", existing._id, doc);
    } else {
      await ctx.db.insert("githubConnections", doc);
    }
    return null;
  },
});
