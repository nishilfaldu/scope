import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";
import { googleScopesAreBounded } from "../../domain/apps";
import { sha256Hex } from "../../lib/secrets";
import { selectedConnection } from "../connections/helpers";
import { denyResultValidator } from "../../lib/errors";
import { denyCreate, sliceAccessDenial } from "./helpers";

export const authorizeOperation = internalMutation({
  args: { brokerToken: v.string(), charge: v.boolean() },
  returns: v.union(
    v.object({
      ok: v.literal(true),
      userId: v.id("users"),
      app: v.literal("files"),
      connectionId: v.id("connections"),
    }),
    denyResultValidator,
  ),
  handler: async (ctx, args) => {
    if (!/^gc_[a-f0-9]{64}$/.test(args.brokerToken))
      return denyCreate(401, "Unknown broker credential", "UNAUTHORIZED");
    const secretHash = await sha256Hex(args.brokerToken);
    const row = await ctx.db
      .query("googleBrokerCredentials")
      .withIndex("by_secretHash", (q) => q.eq("secretHash", secretHash))
      .unique();
    if (!row)
      return denyCreate(401, "Unknown broker credential", "UNAUTHORIZED");
    if (row.expiresAt <= Date.now())
      return denyCreate(403, "Broker credential expired", "EXPIRED");
    const slice = await ctx.db.get("slices", row.sliceId);
    if (!slice) return denyCreate(403, "Slice unavailable", "REVOKED");
    const accessDenial = await sliceAccessDenial(ctx, slice);
    if (accessDenial) return accessDenial;
    const binding = await ctx.db.get("sliceBindings", row.bindingId);
    if (
      !binding ||
      binding.sliceId !== slice._id ||
      binding.app !== row.app ||
      binding.connectionId !== row.connectionId
    )
      return denyCreate(403, "Broker binding unavailable", "APP_UNAVAILABLE");
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
      return denyCreate(403, "Broker account unavailable", "APP_UNAVAILABLE");
    }
    if (args.charge) {
      const now = Date.now();
      const windowStart = slice.brokerWindowStart ?? 0;
      const windowCount =
        now - windowStart >= 60_000 ? 0 : (slice.brokerWindowCount ?? 0);
      if (windowCount >= 30)
        return denyCreate(429, "Broker rate limit exceeded", "PROVIDER_ERROR");
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
