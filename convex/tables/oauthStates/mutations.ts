import { v } from "convex/values";
import {
  env,
  internalMutation,
  type MutationCtx,
} from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import type { AppId } from "../../domain/apps";
import {
  appValidator,
  providerForApp,
  providerValidator,
} from "../../domain/apps";
import { authenticatedMutation } from "../../functions";
import { normalizeReturnTo } from "../../domain/returnPaths";
import { randomSecret, sha256Hex } from "../../lib/secrets";
import { codeChallenge } from "../../oauth/providers/airtable";
import { internal } from "../../_generated/api";
import { connectConfigured } from "../../connect/bridge";

const STATE_TTL_MS = 10 * 60 * 1000;

async function insertState(
  ctx: Pick<MutationCtx, "db" | "scheduler">,
  args: {
    userId: Id<"users">;
    app: AppId;
    state: string;
    returnTo: string;
    connectSubjectId?: string;
    browserProofHash?: string;
    pkceVerifier?: string;
    pkceChallenge?: string;
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
    const pkceVerifier =
      args.app === "airtable" ? randomSecret("pkce_") : undefined;
    await insertState(ctx, {
      userId: ctx.userId,
      app: args.app,
      state,
      connectSubjectId:
        args.app === "slack" && connectConfigured()
          ? `scope:${ctx.userId}:${state}`
          : undefined,
      browserProofHash: await sha256Hex(browserProof),
      pkceVerifier,
      pkceChallenge: pkceVerifier
        ? await codeChallenge(pkceVerifier)
        : undefined,
      returnTo: normalizeReturnTo(args.returnTo, env.BOARD_ORIGIN),
    });
    return { state, browserProof };
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
    if (args.provider !== providerForApp(args.app)) {
      throw new Error("Provider/app mismatch");
    }
    await insertState(ctx, {
      userId: args.userId,
      app: args.app,
      state: args.state,
      returnTo: normalizeReturnTo(args.returnTo, env.BOARD_ORIGIN),
    });
    return null;
  },
});

export const consume = internalMutation({
  args: { state: v.string(), userId: v.id("users"), browserProof: v.string() },
  returns: v.union(
    v.object({
      connectSubjectId: v.optional(v.string()),
      pkceVerifier: v.optional(v.string()),
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
      pkceVerifier: row.pkceVerifier,
      userId: row.userId,
      provider: providerForApp(row.app),
      app: row.app,
      returnTo: row.returnTo,
    };
  },
});
