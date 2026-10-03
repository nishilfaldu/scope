import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";
import { appValidator } from "../../domain/apps";
import { connectReferenceValidator } from "../../connect/contracts";

export const clearConnection = internalMutation({
  args: {
    userId: v.id("users"),
    app: appValidator,
    connectionId: v.id("connections"),
  },
  returns: v.union(v.object({ connect: connectReferenceValidator }), v.null()),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("connections", args.connectionId);
    if (!row || row.userId !== args.userId || row.app !== args.app) return null;
    await ctx.db.delete("connections", row._id);
    return { connect: row.connect };
  },
});
