import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";
import { internalQuery, type QueryCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import { authenticatedQuery } from "../../functions";
import { appValidator, ALL_APPS } from "../../domain/apps";
import {
  denyResultValidator,
  EXPIRED_ERROR,
  REVOKED_ERROR,
  UNAUTHORIZED_ERROR,
} from "../../lib/errors";
import {
  bindingFor,
  effectiveStatus,
  MAX_SLICE_APPS,
  sliceBySecret,
  withoutSecretHash,
} from "./helpers";

const boardSlice = v.object({
  _id: v.id("slices"),
  _creationTime: v.number(),
  userId: v.id("users"),
  name: v.string(),
  token: v.string(),
  status: v.union(
    v.literal("active"),
    v.literal("revoked"),
    v.literal("expired"),
  ),
  expiresAt: v.number(),
  mintPolicy: v.union(v.literal("auto"), v.literal("approve")),
});

async function connectionsForUser(
  ctx: Pick<QueryCtx, "db">,
  userId: Id<"users">,
) {
  return await ctx.db
    .query("connections")
    .withIndex("by_user_provider_app_providerUserId", (q) =>
      q.eq("userId", userId),
    )
    .take(2000);
}

export const list = authenticatedQuery({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(boardSlice),
  handler: async (ctx, args) => {
    const results = await ctx.db
      .query("slices")
      .withIndex("by_user", (q) => q.eq("userId", ctx.userId))
      .order("desc")
      .paginate(args.paginationOpts);
    return { ...results, page: results.page.map(withoutSecretHash) };
  },
});

export const get = authenticatedQuery({
  args: { sliceId: v.string() },
  returns: v.union(boardSlice, v.null()),
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("slices", args.sliceId);
    const slice = id ? await ctx.db.get("slices", id) : null;
    return slice && slice.userId === ctx.userId
      ? withoutSecretHash(slice)
      : null;
  },
});

const binding = v.object({
  _id: v.id("sliceBindings"),
  _creationTime: v.number(),
  sliceId: v.id("slices"),
  app: appValidator,
  connectionId: v.id("connections"),
});

export const bindingsForApps = authenticatedQuery({
  args: { sliceId: v.id("slices"), apps: v.array(appValidator) },
  returns: v.array(binding),
  handler: async (ctx, args) => {
    if (args.apps.length > 50) throw new Error("Request at most 50 apps");
    const slice = await ctx.db.get("slices", args.sliceId);
    if (!slice || slice.userId !== ctx.userId)
      throw new Error("Slice not found");
    const rows = await Promise.all(
      args.apps.map((app) => bindingFor(ctx, slice._id, app)),
    );
    return rows.filter((row): row is NonNullable<typeof row> => row !== null);
  },
});

export const discoverApps = internalQuery({
  args: { sliceToken: v.string(), sliceSecret: v.string(), now: v.number() },
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
    if (!slice)
      return {
        ok: false as const,
        status: 401,
        reason: UNAUTHORIZED_ERROR,
        code: "UNAUTHORIZED" as const,
      };
    const status = effectiveStatus(slice, args.now);
    if (status !== "active")
      return {
        ok: false as const,
        status: 403,
        reason: status === "revoked" ? REVOKED_ERROR : EXPIRED_ERROR,
        code:
          status === "revoked" ? ("REVOKED" as const) : ("EXPIRED" as const),
      };
    const [bindings, connections] = await Promise.all([
      ctx.db
        .query("sliceBindings")
        .withIndex("by_slice", (q) => q.eq("sliceId", slice._id))
        .take(MAX_SLICE_APPS + 1),
      connectionsForUser(ctx, slice.userId),
    ]);
    const bound = new Map(
      bindings.map((item) => [item.app, item.connectionId]),
    );
    const connectedIds = new Set(
      connections.map((connection) => connection._id),
    );
    const connectedApps = new Set(
      connections.map((connection) => connection.app),
    );
    // The user may have more than 2,000 accounts. Check any selected account
    // absent from the bounded summary query by its exact ID.
    await Promise.all(
      bindings
        .filter((item) => !connectedIds.has(item.connectionId))
        .map(async (item) => {
          const account = await ctx.db.get("connections", item.connectionId);
          if (
            account &&
            account.userId === slice.userId &&
            account.app === item.app
          ) {
            connectedIds.add(item.connectionId);
          }
        }),
    );
    return {
      ok: true as const,
      expiresAt: slice.expiresAt,
      apps: ALL_APPS.map((app) => ({
        app,
        allowed: bound.has(app),
        connected: bound.has(app)
          ? connectedIds.has(bound.get(app)!)
          : connectedApps.has(app),
      })),
    };
  },
});
