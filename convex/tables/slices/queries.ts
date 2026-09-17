import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";
import { internalQuery, type QueryCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import { authenticatedQuery } from "../../functions";
import { appValidator, ALL_APPS } from "../../domain/apps";
import schema from "../../schema";
import {
  denyResultValidator,
  EXPIRED_ERROR,
  REVOKED_ERROR,
  UNAUTHORIZED_ERROR,
} from "../../lib/errors";
import { connectionsForApp, selectedConnection } from "../connections/helpers";
import { effectiveMintPolicy, sliceBySecret, withoutSecretHash } from "./helpers";

const mintPolicyValidator = v.union(v.literal("auto"), v.literal("approve"));

const boardSlice = schema
  .doc("slices")
  .omit("secretHash", "mintPolicy")
  .extend({
    grantApps: v.array(appValidator),
    connectedApps: v.array(appValidator),
    grantBindings: v.array(v.object({ app: appValidator, connectionId: v.id("connections") })),
    mintPolicy: mintPolicyValidator,
  });

async function connectedAppsForUser(
  ctx: Pick<QueryCtx, "db">,
  userId: Id<"users">,
) {
  const connected = await Promise.all(ALL_APPS.map(async (app) => ({ app, available: (await connectionsForApp(ctx, userId, app)).length > 0 })));
  return connected.filter((entry) => entry.available).map((entry) => entry.app);
}

export const list = authenticatedQuery({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(boardSlice),
  handler: async (ctx, args) => {
    const { userId } = ctx;
    const results = await ctx.db
      .query("slices")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .paginate(args.paginationOpts);
    return {
      ...results,
      page: await Promise.all(
        results.page.map(async (slice) => {
          const grant = await ctx.db.get("grants", slice.grantId);
          const connectedApps = await connectedAppsForUser(ctx, slice.userId);
          return {
            ...withoutSecretHash(slice),
            grantApps: grant?.apps ?? [],
            grantBindings: grant?.bindings ?? [],
            connectedApps,
            mintPolicy: effectiveMintPolicy(slice),
          };
        }),
      ),
    };
  },
});

export const get = authenticatedQuery({
  args: { sliceId: v.string() },
  returns: v.union(boardSlice, v.null()),
  handler: async (ctx, args) => {
    const { userId } = ctx;
    const id = ctx.db.normalizeId("slices", args.sliceId);
    if (!id) {
      return null;
    }
    const slice = await ctx.db.get("slices", id);
    if (!slice || slice.userId !== userId) {
      return null;
    }
    const grant = await ctx.db.get("grants", slice.grantId);
    const connectedApps = await connectedAppsForUser(ctx, slice.userId);
    return {
      ...withoutSecretHash(slice),
      grantApps: grant?.apps ?? [],
      grantBindings: grant?.bindings ?? [],
      connectedApps,
      mintPolicy: effectiveMintPolicy(slice),
    };
  },
});

export const discoverApps = internalQuery({
  args: {
    sliceToken: v.string(),
    sliceSecret: v.string(),
    now: v.number(),
  },
  returns: v.union(
    v.object({
      ok: v.literal(true),
      expiresAt: v.number(),
      apps: v.array(
        v.object({
          app: appValidator,
          allowed: v.boolean(),
          connected: v.boolean(),
        }),
      ),
    }),
    denyResultValidator,
  ),
  handler: async (ctx, args) => {
    const slice = await sliceBySecret(ctx, args);
    if (!slice) {
      return {
        ok: false as const,
        status: 401,
        reason: UNAUTHORIZED_ERROR,
        code: "UNAUTHORIZED" as const,
      };
    }
    if (slice.status === "revoked") {
      return {
        ok: false as const,
        status: 403,
        reason: REVOKED_ERROR,
        code: "REVOKED" as const,
      };
    }
    if (slice.status === "expired" || slice.expiresAt <= args.now) {
      return {
        ok: false as const,
        status: 403,
        reason: EXPIRED_ERROR,
        code: "EXPIRED" as const,
      };
    }
    const grant = await ctx.db.get("grants", slice.grantId);
    if (!grant) {
      return {
        ok: false as const,
        status: 401,
        reason: UNAUTHORIZED_ERROR,
        code: "UNAUTHORIZED" as const,
      };
    }
    const connectedApps = await connectedAppsForUser(ctx, slice.userId);
    const boundApps = new Set((await Promise.all(grant.bindings.map(async (binding) => ({
      app: binding.app,
      connected: !!await selectedConnection(ctx, slice.userId, binding.app, binding.connectionId),
    })))).filter((binding) => binding.connected).map((binding) => binding.app));
    return {
      ok: true as const,
      expiresAt: slice.expiresAt,
      apps: ALL_APPS.map((app) => ({
        app,
        allowed: grant.apps.includes(app),
        connected: grant.apps.includes(app) ? boundApps.has(app) : connectedApps.includes(app),
      })),
    };
  },
});
