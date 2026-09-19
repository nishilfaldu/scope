import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";
import { internalQuery } from "../../_generated/server";
import { authenticatedQuery } from "../../functions";
import { appValidator, ALL_APPS, isAppId } from "../../domain/apps";
import { selectedConnection } from "../connections/helpers";
import {
  denyResultValidator,
  APP_UNAVAILABLE_ERROR,
  EXPIRED_ERROR,
  REVOKED_ERROR,
  UNAUTHORIZED_ERROR,
} from "../../lib/errors";
import {
  bindingsForApp,
  effectiveStatus,
  hasActiveAgentConnection,
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

export const list = authenticatedQuery({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(boardSlice),
  handler: async (ctx, args) => {
    const results = await ctx.db
      .query("slices")
      .withIndex("by_user", (q) => q.eq("userId", ctx.userId))
      .order("desc")
      .paginate(args.paginationOpts);
    const page = await Promise.all(
      results.page.map(async (slice) => ({
        ...withoutSecretHash(slice),
        status: (await hasActiveAgentConnection(ctx, slice))
          ? effectiveStatus(slice)
          : ("revoked" as const),
      })),
    );
    return { ...results, page };
  },
});

export const get = authenticatedQuery({
  args: { sliceId: v.string() },
  returns: v.union(boardSlice, v.null()),
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("slices", args.sliceId);
    const slice = id ? await ctx.db.get("slices", id) : null;
    if (!slice || slice.userId !== ctx.userId) return null;
    return {
      ...withoutSecretHash(slice),
      status: (await hasActiveAgentConnection(ctx, slice))
        ? effectiveStatus(slice)
        : ("revoked" as const),
    };
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
    const slice = await ctx.db.get("slices", args.sliceId);
    if (!slice || slice.userId !== ctx.userId)
      throw new Error("Slice not found");
    const rows = await Promise.all(
      args.apps.map((app) => bindingsForApp(ctx, slice._id, app)),
    );
    return rows.flat();
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
    const bindings = await ctx.db
      .query("sliceBindings")
      .withIndex("by_slice_app_connectionId", (q) => q.eq("sliceId", slice._id))
      .collect();
    const bound = new Set(bindings.map((item) => item.app));
    const connected = new Set(
      (
        await Promise.all(
          bindings.map(async (item) => {
            const account = await ctx.db.get("connections", item.connectionId);
            return account &&
              account.userId === slice.userId &&
              account.app === item.app
              ? item.app
              : null;
          }),
        )
      ).filter((app): app is NonNullable<typeof app> => app !== null),
    );
    return {
      ok: true as const,
      expiresAt: slice.expiresAt,
      apps: ALL_APPS.map((app) => ({
        app,
        allowed: bound.has(app),
        connected: connected.has(app),
      })),
    };
  },
});

export const discoverAccounts = internalQuery({
  args: {
    sliceToken: v.string(),
    sliceSecret: v.string(),
    app: v.string(),
    now: v.number(),
  },
  returns: v.union(
    v.object({
      ok: v.literal(true),
      app: appValidator,
      accounts: v.array(
        v.object({ bindingId: v.id("sliceBindings"), login: v.string() }),
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
    const app = args.app;
    if (!isAppId(app))
      return {
        ok: false as const,
        status: 403,
        reason: APP_UNAVAILABLE_ERROR,
        code: "APP_UNAVAILABLE" as const,
      };
    const bindings = await bindingsForApp(ctx, slice._id, app);
    const accounts = (
      await Promise.all(
        bindings.map(async (binding) => {
          const connection = await selectedConnection(
            ctx,
            slice.userId,
            app,
            binding.connectionId,
          );
          return connection
            ? { bindingId: binding._id, login: connection.login }
            : null;
        }),
      )
    ).filter(
      (account): account is NonNullable<typeof account> => account !== null,
    );
    return { ok: true as const, app, accounts };
  },
});
