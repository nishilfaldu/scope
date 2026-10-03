import { v } from "convex/values";
import { internal } from "../../_generated/api";
import { authenticatedAction } from "../../functions";
import { revokeProviderGrant } from "../../oauth";
import { appValidator, providerForApp } from "../../domain/apps";
import { decryptToken } from "../../lib/tokenEncryption";
import { callBridge } from "../../connect/bridge";

export const disconnect = authenticatedAction({
  args: { app: appValidator, connectionId: v.id("connections") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const removed = await ctx.runMutation(
      internal.tables.connections.mutations.clearConnection,
      { userId: ctx.userId, app: args.app, connectionId: args.connectionId },
    );
    if (removed?.connect) {
      try {
        await callBridge(ctx, {
          operation: "revoke",
          reference: removed.connect,
        });
      } catch {
        /* Local disconnect committed; upstream revocation is best effort. */
      }
    } else if (removed?.revokeUpstream) {
      try {
        await revokeProviderGrant(
          providerForApp(args.app),
          await decryptToken(removed.storedAccessToken),
        );
      } catch {
        // Local revocation has already committed. Provider revocation is best effort.
      }
    }
    return null;
  },
});
