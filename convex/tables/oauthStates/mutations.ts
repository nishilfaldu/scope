import { v } from "convex/values";
import { internalMutation, type MutationCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import type { AppId, ProviderId } from "../../domain/apps";
import {
  appValidator,
  providerForApp,
  providerValidator,
} from "../../domain/apps";
import { authenticatedMutation } from "../../functions";
import { allowedReturnTo } from "../../http/helpers";

const STATE_TTL_MS = 10 * 60 * 1000;

async function insertState(
  ctx: Pick<MutationCtx, "db">,
  args: {
    userId: Id<"users">;
    provider: ProviderId;
    app: AppId;
    state: string;
    returnTo: string;
  },
) {
  await ctx.db.insert("oauthStates", {
    ...args,
    expiresAt: Date.now() + STATE_TTL_MS,
  });
}

export const start = authenticatedMutation({
  args: { app: appValidator, returnTo: v.string() },
  returns: v.object({ state: v.string() }),
  handler: async (ctx, args) => {
    const state = crypto.randomUUID();
    await insertState(ctx, {
      userId: ctx.userId,
      provider: providerForApp(args.app),
      app: args.app,
      state,
      returnTo: allowedReturnTo(args.returnTo),
    });
    return { state };
  },
});

export const put = internalMutation({
  args: {
    userId: v.id("users"),
    provider: providerValidator,
    app: appValidator,
    state: v.string(),
    returnTo: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await insertState(ctx, args);
    return null;
  },
});

export const consume = internalMutation({
  args: { state: v.string() },
  returns: v.union(
    v.object({
      userId: v.id("users"),
      provider: providerValidator,
      app: appValidator,
      returnTo: v.string(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("oauthStates")
      .withIndex("by_state", (q) => q.eq("state", args.state))
      .unique();
    if (!row) return null;
    await ctx.db.delete("oauthStates", row._id);
    if (row.expiresAt <= Date.now()) return null;
    return {
      userId: row.userId,
      provider: row.provider,
      app: row.app,
      returnTo: row.returnTo,
    };
  },
});
