import { v } from "convex/values";
import { internal } from "../../_generated/api";
import { authenticatedAction } from "../../functions";
import { revokeProviderGrant } from "../../oauth";
import { appValidator, providerForApp } from "../../domain/apps";
import { decryptToken } from "../../lib/tokenEncryption";

export const disconnect = authenticatedAction({
  args: { app: appValidator, connectionId: v.id("connections") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const removed = await ctx.runMutation(
      internal.tables.connections.mutations.clearConnection,
      { userId: ctx.userId, app: args.app, connectionId: args.connectionId },
    );
    if (removed?.revokeUpstream) {
      try {
        await revokeProviderGrant(providerForApp(args.app), await decryptToken(removed.storedAccessToken));
      } catch {
        // Local revocation has already committed. Provider revocation is best effort.
      }
    }
    return null;
  },
});
