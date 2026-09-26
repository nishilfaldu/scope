import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";
import { effectiveSliceStatus } from "../../domain/slices";
import { googleScopesAreBounded } from "../../domain/apps";
import { sha256Hex } from "../../lib/secrets";
import { hasActiveAgentConnection } from "./helpers";
import { selectedConnection } from "../connections/helpers";

export const authorizeOperation = internalMutation({
  args: { brokerToken: v.string(), charge: v.boolean() },
  returns: v.union(
    v.object({
      ok: v.literal(true),
      userId: v.id("users"),
      app: v.union(v.literal("drive"), v.literal("docs"), v.literal("sheets")),
      connectionId: v.id("connections"),
    }),
    v.object({ ok: v.literal(false), rateLimited: v.boolean() }),
  ),
  handler: async (ctx, args) => {
    if (!/^gc_[a-f0-9]{64}$/.test(args.brokerToken))
      return { ok: false as const, rateLimited: false };
    const secretHash = await sha256Hex(args.brokerToken);
    const row = await ctx.db
      .query("googleBrokerCredentials")
      .withIndex("by_secretHash", (q) => q.eq("secretHash", secretHash))
      .unique();
    if (!row || row.expiresAt <= Date.now())
      return { ok: false as const, rateLimited: false };
    const slice = await ctx.db.get("slices", row.sliceId);
    if (
      !slice ||
      effectiveSliceStatus(slice) !== "active" ||
      !(await hasActiveAgentConnection(ctx, slice))
    )
      return { ok: false as const, rateLimited: false };
    const binding = await ctx.db.get("sliceBindings", row.bindingId);
    if (
      !binding ||
      binding.sliceId !== slice._id ||
      binding.app !== row.app ||
      binding.connectionId !== row.connectionId
    )
      return { ok: false as const, rateLimited: false };
    const connection = await selectedConnection(
      ctx,
      slice.userId,
      row.app,
      row.connectionId,
    );
    if (
      !connection ||
      (connection.connectionGeneration ?? 0) !== row.connectionGeneration ||
      !googleScopesAreBounded(row.app, connection.grantedScopes)
    ) {
      return { ok: false as const, rateLimited: false };
    }
    if (args.charge) {
      const now = Date.now();
      const windowStart = slice.brokerWindowStart ?? 0;
      const windowCount =
        now - windowStart >= 60_000 ? 0 : (slice.brokerWindowCount ?? 0);
      if (windowCount >= 30) return { ok: false as const, rateLimited: true };
      await ctx.db.patch("slices", slice._id, {
        brokerWindowStart: windowCount === 0 ? now : windowStart,
        brokerWindowCount: windowCount + 1,
      });
    }
    return {
      ok: true as const,
      userId: slice.userId,
      app: row.app,
      connectionId: row.connectionId,
    };
  },
});

export const expire = internalMutation({
  args: { brokerId: v.id("googleBrokerCredentials") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("googleBrokerCredentials", args.brokerId);
    if (row && row.expiresAt <= Date.now()) {
      await ctx.db.delete("googleBrokerCredentials", row._id);
    }
    return null;
  },
});
