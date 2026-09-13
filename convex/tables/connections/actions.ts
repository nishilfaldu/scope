import { v } from "convex/values";
import { internal } from "../../_generated/api";
import { action } from "../../_generated/server";
import { revokeProviderGrant } from "../../oauth";
import { providerValidator } from "../../permissions";

export const disconnect = action({
  args: { provider: providerValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const connection = await ctx.runQuery(
      internal.tables.connections.queries.getConnection,
      { provider: args.provider },
    );
    if (connection) {
      await revokeProviderGrant(args.provider, connection.accessToken);
    }
    await ctx.runMutation(internal.tables.connections.mutations.clearConnection, {
      provider: args.provider,
    });
    return null;
  },
});
