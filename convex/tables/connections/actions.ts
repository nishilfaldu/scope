import { v } from "convex/values";
import { internal } from "../../_generated/api";
import { authenticatedAction } from "../../functions";
import { appValidator } from "../../domain/apps";
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
      } catch {}
    }
    return null;
  },
});
