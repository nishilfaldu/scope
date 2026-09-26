import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";
import { internal } from "../../_generated/api";
import {
  isAppId,
  appValidator,
  providerForApp,
  providerValidator,
} from "../../domain/apps";
import { effectiveSliceStatus } from "../../domain/slices";
import {
  denyResultValidator,
  APP_UNAVAILABLE_ERROR,
  EXPIRED_ERROR,
  REVOKED_ERROR,
  UNAUTHORIZED_ERROR,
} from "../../lib/errors";
import { selectedConnection } from "../connections/helpers";
import {
  bindingsForApp,
  denyCreate,
  hasActiveAgentConnection,
  githubGrantIsExclusive,
  sliceBySecret,
} from "./helpers";

const mintPolicyValidator = v.union(v.literal("auto"), v.literal("approve"));

export const authorizeCreate = internalMutation({
  args: {
    sliceToken: v.string(),
    sliceSecret: v.string(),
    app: v.string(),
    bindingId: v.optional(v.string()),
  },
  returns: v.union(
    v.object({
      ok: v.literal(true),
      sliceId: v.id("slices"),
      userId: v.id("users"),
      app: appValidator,
      provider: providerValidator,
      bindingId: v.id("sliceBindings"),
      connectionId: v.id("connections"),
      mintPolicy: mintPolicyValidator,
    }),
    denyResultValidator,
  ),
  handler: async (ctx, args) => {
    const slice = await sliceBySecret(ctx, args);
    if (!slice) return denyCreate(401, UNAUTHORIZED_ERROR, "UNAUTHORIZED");
    if (!isAppId(args.app))
      return denyCreate(403, APP_UNAVAILABLE_ERROR, "APP_UNAVAILABLE");
    const status = effectiveSliceStatus(slice);
    if (status === "revoked") return denyCreate(403, REVOKED_ERROR, "REVOKED");
    if (status === "expired") return denyCreate(403, EXPIRED_ERROR, "EXPIRED");
    const bindingId =
      args.bindingId === undefined
        ? null
        : ctx.db.normalizeId("sliceBindings", args.bindingId);
    const matches =
      args.bindingId === undefined
        ? await bindingsForApp(ctx, slice._id, args.app)
        : [];
    if (matches.length > 1)
      return denyCreate(
        409,
        "Multiple accounts are allowed for this app; choose a bindingId from GET /api/accounts",
        "ACCOUNT_SELECTION_REQUIRED",
      );
    const binding = bindingId
      ? await ctx.db.get("sliceBindings", bindingId)
      : matches[0];
    const connection =
      binding && binding.sliceId === slice._id && binding.app === args.app
        ? await selectedConnection(
            ctx,
            slice.userId,
            args.app,
            binding.connectionId,
          )
        : null;
    if (!connection)
      return denyCreate(403, APP_UNAVAILABLE_ERROR, "APP_UNAVAILABLE");
    if (
      args.app === "github" &&
      !(await githubGrantIsExclusive(ctx, connection._id, slice.agentId))
    ) {
      return denyCreate(
        403,
        "GitHub grant is shared by multiple agents",
        "APP_UNAVAILABLE",
      );
    }
    return {
      ok: true as const,
      sliceId: slice._id,
      userId: slice.userId,
      app: args.app,
      provider: providerForApp(args.app),
      bindingId: binding!._id,
      connectionId: connection._id,
      mintPolicy: slice.mintPolicy,
    };
  },
});

// Run after the provider refresh. This is the final policy check before returning
// a bearer token, and the only place an approved mint request is consumed.
export const finalize = internalMutation({
  args: {
    sliceId: v.id("slices"),
    app: appValidator,
    bindingId: v.id("sliceBindings"),
    connectionId: v.id("connections"),
    requestId: v.optional(v.id("tokenRequests")),
    brokerSecretHash: v.optional(v.string()),
  },
  returns: v.union(
    v.object({ ok: v.literal(true), expiresAt: v.number() }),
    denyResultValidator,
  ),
  handler: async (ctx, args) => {
    const slice = await ctx.db.get("slices", args.sliceId);
    if (!slice) return denyCreate(401, UNAUTHORIZED_ERROR, "UNAUTHORIZED");
    if (!(await hasActiveAgentConnection(ctx, slice))) {
      return denyCreate(403, REVOKED_ERROR, "REVOKED");
    }
    const status = effectiveSliceStatus(slice);
    if (status === "revoked") return denyCreate(403, REVOKED_ERROR, "REVOKED");
    if (status === "expired") return denyCreate(403, EXPIRED_ERROR, "EXPIRED");
    const binding = await ctx.db.get("sliceBindings", args.bindingId);
    const selected = await selectedConnection(
      ctx,
      slice.userId,
      args.app,
      args.connectionId,
    );
    if (
      binding?.sliceId !== slice._id ||
      binding.app !== args.app ||
      binding.connectionId !== args.connectionId ||
      !selected
    ) {
      return denyCreate(403, APP_UNAVAILABLE_ERROR, "APP_UNAVAILABLE");
    }
    if (
      args.app === "github" &&
      !(await githubGrantIsExclusive(ctx, args.connectionId, slice.agentId))
    ) {
      return denyCreate(
        403,
        "GitHub grant is shared by multiple agents",
        "APP_UNAVAILABLE",
      );
    }
    if (args.requestId) {
      const request = await ctx.db.get("tokenRequests", args.requestId);
      if (
        !request ||
        request.sliceId !== slice._id ||
        request.app !== args.app ||
        request.bindingId !== args.bindingId ||
        request.status !== "approved" ||
        request.expiresAt <= Date.now()
      ) {
        return denyCreate(
          403,
          "Credential request is no longer claimable",
          "APPROVAL_EXPIRED",
        );
      }
      await ctx.db.patch("tokenRequests", request._id, {
        status: "claimed",
      });
    } else if (slice.mintPolicy !== "auto") {
      return denyCreate(403, "Operator approval required", "APPROVAL_REQUIRED");
    }
    const expiresAt = Math.min(slice.expiresAt, Date.now() + 15 * 60_000);
    if (args.brokerSecretHash) {
      if (!["drive", "docs", "sheets"].includes(args.app)) {
        return denyCreate(403, APP_UNAVAILABLE_ERROR, "APP_UNAVAILABLE");
      }
      const brokerId = await ctx.db.insert("googleBrokerCredentials", {
        secretHash: args.brokerSecretHash,
        sliceId: args.sliceId,
        bindingId: args.bindingId,
        connectionId: args.connectionId,
        app: args.app as "drive" | "docs" | "sheets",
        connectionGeneration: selected.connectionGeneration ?? 0,
        expiresAt,
      });
      await ctx.scheduler.runAfter(
        15 * 60_000 + 1000,
        internal.tables.slices.googleBroker.expire,
        { brokerId },
      );
    }
    return { ok: true as const, expiresAt };
  },
});
