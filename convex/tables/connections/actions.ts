import { v } from "convex/values";
import { internal } from "../../_generated/api";
import { authenticatedAction } from "../../functions";
import { revokeProviderGrant } from "../../oauth";
import { appValidator, providerForApp } from "../../domain/apps";

export const disconnect = authenticatedAction({
  args: { app: appValidator, connectionId: v.id("connections") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const connection = await ctx.runQuery(
      internal.tables.connections.queries.getConnection,
      { userId: ctx.userId, app: args.app, connectionId: args.connectionId },
    );
    if (connection) {
      const otherGoogleApps = providerForApp(args.app) === "google"
        ? await ctx.runQuery(internal.tables.connections.queries.hasOtherGoogleApps, {
            userId: ctx.userId, providerUserId: connection.providerUserId, exceptId: args.connectionId,
          })
        : false;
      if (!otherGoogleApps) await revokeProviderGrant(providerForApp(args.app), connection.accessToken);
    }
    await ctx.runMutation(
      internal.tables.connections.mutations.clearConnection,
      {
        userId: ctx.userId,
        app: args.app,
        connectionId: args.connectionId,
      },
    );
    return null;
  },
});
