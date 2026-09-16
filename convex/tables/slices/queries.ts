import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";
import { internalQuery, type QueryCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import { authenticatedQuery } from "../../functions";
import { appValidator, ALL_APPS, providerForApp } from "../../domain/apps";
import schema from "../../schema";
import { denyResultValidator, UNAUTHORIZED_ERROR } from "../../lib/errors";
import { effectiveMintPolicy, sliceBySecret, withoutSecretHash } from "./helpers";

const mintPolicyValidator = v.union(v.literal("auto"), v.literal("approve"));

const boardSlice = schema
  .doc("slices")
  .omit("secretHash", "mintPolicy")
  .extend({
    grantApps: v.array(appValidator),
    connectedApps: v.array(appValidator),
    mintPolicy: mintPolicyValidator,
  });

async function connectedAppsForUser(
  ctx: Pick<QueryCtx, "db">,
  userId: Id<"users">,
) {
  const connectedProviders = new Set<string>();
  for (const app of ALL_APPS) {
    const provider = providerForApp(app);
    if (connectedProviders.has(provider)) continue;
    const connection = await ctx.db
      .query("connections")
      .withIndex("by_user_and_provider", (q) =>
        q.eq("userId", userId).eq("provider", provider),
      )
      .unique();
    if (connection) connectedProviders.add(provider);
  }
  return ALL_APPS.filter((app) => connectedProviders.has(providerForApp(app)));
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
        reason: "Passport revoked",
        code: "REVOKED" as const,
      };
    }
    if (slice.status === "expired" || slice.expiresAt <= args.now) {
      return {
        ok: false as const,
        status: 403,
        reason: "Passport expired",
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
    return {
      ok: true as const,
      expiresAt: slice.expiresAt,
      apps: ALL_APPS.map((app) => ({
        app,
        allowed: grant.apps.includes(app),
        connected: connectedApps.includes(app),
      })),
    };
  },
});
