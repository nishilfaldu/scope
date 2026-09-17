import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";
import { isAppId, appValidator, providerForApp, providerValidator } from "../../domain/apps";
import { denyResultValidator, APP_UNAVAILABLE_ERROR, EXPIRED_ERROR, REVOKED_ERROR, UNAUTHORIZED_ERROR } from "../../lib/errors";
import { selectedConnection } from "../connections/helpers";
import { bindingFor, denyCreate, effectiveStatus, sliceBySecret } from "./helpers";

const mintPolicyValidator = v.union(v.literal("auto"), v.literal("approve"));

export const authorizeCreate = internalMutation({
  args: { sliceToken: v.string(), sliceSecret: v.string(), app: v.string() },
  returns: v.union(
    v.object({
      ok: v.literal(true), sliceId: v.id("slices"), userId: v.id("users"),
      app: appValidator, provider: providerValidator,
      connectionId: v.id("connections"), mintPolicy: mintPolicyValidator,
    }),
    denyResultValidator,
  ),
  handler: async (ctx, args) => {
    const slice = await sliceBySecret(ctx, args);
    if (!slice) return denyCreate(401, UNAUTHORIZED_ERROR, "UNAUTHORIZED");
    if (!isAppId(args.app)) return denyCreate(403, APP_UNAVAILABLE_ERROR, "APP_UNAVAILABLE");
    const status = effectiveStatus(slice);
    if (status === "revoked") return denyCreate(403, REVOKED_ERROR, "REVOKED");
    if (status === "expired") return denyCreate(403, EXPIRED_ERROR, "EXPIRED");
    const binding = await bindingFor(ctx, slice._id, args.app);
    const connection = binding
      ? await selectedConnection(ctx, slice.userId, args.app, binding.connectionId) : null;
    if (!connection) return denyCreate(403, APP_UNAVAILABLE_ERROR, "APP_UNAVAILABLE");
    return {
      ok: true as const, sliceId: slice._id, userId: slice.userId,
      app: args.app, provider: providerForApp(args.app),
      connectionId: connection._id, mintPolicy: slice.mintPolicy,
    };
  },
});

// Run after the provider refresh. This is the final policy check before returning
// a bearer token, and the only place an approved mint request is consumed.
export const finalize = internalMutation({
  args: {
    sliceId: v.id("slices"), app: appValidator,
    connectionId: v.id("connections"),
    requestId: v.optional(v.id("accessRequests")),
  },
  returns: v.union(
    v.object({ ok: v.literal(true) }),
    denyResultValidator,
  ),
  handler: async (ctx, args) => {
    const slice = await ctx.db.get("slices", args.sliceId);
    if (!slice) return denyCreate(401, UNAUTHORIZED_ERROR, "UNAUTHORIZED");
    const status = effectiveStatus(slice);
    if (status === "revoked") return denyCreate(403, REVOKED_ERROR, "REVOKED");
    if (status === "expired") return denyCreate(403, EXPIRED_ERROR, "EXPIRED");
    const binding = await bindingFor(ctx, slice._id, args.app);
    if (binding?.connectionId !== args.connectionId ||
        !await selectedConnection(ctx, slice.userId, args.app, args.connectionId)) {
      return denyCreate(403, APP_UNAVAILABLE_ERROR, "APP_UNAVAILABLE");
    }
    if (args.requestId) {
      const request = await ctx.db.get("accessRequests", args.requestId);
      if (!request || request.kind !== "mint" || request.sliceId !== slice._id ||
          request.app !== args.app || request.status !== "approved" ||
          request.expiresAt <= Date.now()) {
        return denyCreate(403, "Credential request is no longer claimable", "APPROVAL_EXPIRED");
      }
      await ctx.db.patch("accessRequests", request._id, {
        status: "claimed", claimedAt: Date.now(),
      });
    } else if (slice.mintPolicy !== "auto") {
      return denyCreate(403, "Operator approval required", "APPROVAL_REQUIRED");
    }
    return { ok: true as const };
  },
});
