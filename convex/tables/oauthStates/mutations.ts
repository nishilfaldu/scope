import { v } from "convex/values";
import {
  env,
  internalMutation,
  type MutationCtx,
} from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import type { AppId } from "../../domain/apps";
import { appValidator } from "../../domain/apps";
import { authenticatedMutation } from "../../functions";
import { normalizeReturnTo } from "../../domain/returnPaths";
import { randomSecret, sha256Hex } from "../../lib/secrets";
import { internal } from "../../_generated/api";

const STATE_TTL_MS = 10 * 60 * 1000;

async function insertState(
  ctx: Pick<MutationCtx, "db" | "scheduler">,
  args: {
    userId: Id<"users">;
    app: AppId;
    state: string;
    returnTo: string;
    connectSubjectId: string;
    browserProofHash: string;
  },
) {
  await ctx.db.insert("oauthStates", {
    ...args,
    expiresAt: Date.now() + STATE_TTL_MS,
  });
  await ctx.scheduler.runAfter(
    STATE_TTL_MS,
    internal.tables.oauthStates.mutations.expire,
    {
      state: args.state,
    },
  );
}

export const expire = internalMutation({
  args: { state: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("oauthStates")
      .withIndex("by_state", (q) => q.eq("state", args.state))
      .unique();
    if (row && row.expiresAt <= Date.now()) {
      await ctx.db.delete("oauthStates", row._id);
    }
    return null;
  },
});

export const start = authenticatedMutation({
  args: { app: appValidator, returnTo: v.string() },
  returns: v.object({ state: v.string(), browserProof: v.string() }),
  handler: async (ctx, args) => {
    const state = crypto.randomUUID();
    const browserProof = randomSecret("bp_");
    await insertState(ctx, {
      userId: ctx.userId,
      app: args.app,
      state,
      connectSubjectId: `scope:${ctx.userId}:${state}`,
      browserProofHash: await sha256Hex(browserProof),
      returnTo: normalizeReturnTo(args.returnTo, env.BOARD_ORIGIN),
    });
    return { state, browserProof };
  },
});

export const consume = internalMutation({
  args: { state: v.string(), userId: v.id("users"), browserProof: v.string() },
  returns: v.union(
    v.object({
      connectSubjectId: v.string(),
      userId: v.id("users"),
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
    if (
      !row ||
      row.userId !== args.userId ||
      !row.browserProofHash ||
      row.browserProofHash !== (await sha256Hex(args.browserProof)) ||
      row.expiresAt <= Date.now()
    )
      return null;
    await ctx.db.delete("oauthStates", row._id);
    return {
      connectSubjectId: row.connectSubjectId,
      userId: row.userId,
      app: row.app,
      returnTo: row.returnTo,
    };
  },
});
