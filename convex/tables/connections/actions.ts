import { v } from "convex/values";
import { internal } from "../../_generated/api";
import { authenticatedAction } from "../../functions";
import { revokeProviderGrant } from "../../oauth";
import { providerValidator } from "../../domain/apps";

export const disconnect = authenticatedAction({
  args: { provider: providerValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const connection = await ctx.runQuery(
      internal.tables.connections.queries.getConnection,
      { userId: ctx.userId, provider: args.provider },
    );
    if (connection) {
      await revokeProviderGrant(args.provider, connection.accessToken);
    }
    await ctx.runMutation(
      internal.tables.connections.mutations.clearConnection,
      {
        userId: ctx.userId,
        provider: args.provider,
      },
    );
    return null;
  },
});
