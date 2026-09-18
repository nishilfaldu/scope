import { v } from "convex/values";
import { internalQuery } from "../../_generated/server";
import { authenticatedQuery } from "../../functions";
import { appValidator, providerForApp, providerValidator } from "../../domain/apps";
import { decryptToken } from "../../lib/tokenEncryption";
import { connectionsForApp, selectedConnection } from "./helpers";

const connectionValidator = v.object({
  accessToken: v.string(), login: v.string(), providerUserId: v.string(),
  refreshToken: v.union(v.string(), v.null()), tokenExpiresAt: v.union(v.number(), v.null()),
});

export const statusesForApps = authenticatedQuery({
  args: { apps: v.array(appValidator) },
  returns: v.array(v.object({
    app: appValidator, provider: providerValidator, connected: v.boolean(),
    accounts: v.array(v.object({ id: v.id("connections"), login: v.string(), providerUserId: v.string() })),
  })),
  handler: async (ctx, args) => {
    if (new Set(args.apps).size !== args.apps.length) throw new Error("Apps must be distinct");
    return await Promise.all(args.apps.map(async (app) => {
      const rows = await connectionsForApp(ctx, ctx.userId, app);
      return {
        app, provider: providerForApp(app), connected: rows.length > 0,
        accounts: rows.map((row) => ({ id: row._id, login: row.login, providerUserId: row.providerUserId })),
      };
    }));
  },
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
