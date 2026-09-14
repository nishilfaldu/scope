import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";
import { providerValidator } from "../../domain/apps";

const STATE_TTL_MS = 10 * 60 * 1000;

export const put = internalMutation({
  args: {
    provider: providerValidator,
    state: v.string(),
    returnTo: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("oauthStates", {
      provider: args.provider,
      state: args.state,
      returnTo: args.returnTo,
      expiresAt: Date.now() + STATE_TTL_MS,
    });
    return null;
  },
});

export const consume = internalMutation({
  args: { state: v.string() },
  returns: v.union(
    v.object({ provider: providerValidator, returnTo: v.string() }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("oauthStates")
      .withIndex("by_state", (q) => q.eq("state", args.state))
      .unique();
    if (!row) {
      return null;
    }
    await ctx.db.delete("oauthStates", row._id);
    if (row.expiresAt <= Date.now()) {
      return null;
    }
    return { provider: row.provider, returnTo: row.returnTo };
  },
});
