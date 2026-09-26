import { v } from "convex/values";
import { internalQuery } from "../../_generated/server";
import { appValidator } from "../../domain/apps";

export const get = internalQuery({
  args: { state: v.string() },
  returns: v.union(
    v.object({ app: appValidator, pkceChallenge: v.optional(v.string()) }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("oauthStates")
      .withIndex("by_state", (q) => q.eq("state", args.state))
      .unique();
    if (!row || row.expiresAt <= Date.now()) return null;
    return { app: row.app, pkceChallenge: row.pkceChallenge };
  },
});
