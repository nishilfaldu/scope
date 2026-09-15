import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";
import { internalQuery, query } from "../../_generated/server";
import { appValidator, ALL_APPS } from "../../domain/apps";
import schema from "../../schema";
import {
  denyResultValidator,
  UNAUTHORIZED_ERROR,
} from "../../lib/errors";
import { sliceBySecret, withoutSecretHash } from "./helpers";

const boardSlice = schema.doc("slices").omit("secretHash");

export const list = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(boardSlice),
  handler: async (ctx, args) => {
    const results = await ctx.db
      .query("slices")
      .order("desc")
      .paginate(args.paginationOpts);
    return {
      ...results,
      page: results.page.map(withoutSecretHash),
    };
  },
});

export const get = query({
  args: { sliceId: v.string() },
  returns: v.union(boardSlice, v.null()),
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("slices", args.sliceId);
    if (!id) {
      return null;
    }
    const slice = await ctx.db.get("slices", id);
    if (!slice) {
      return null;
    }
    return withoutSecretHash(slice);
  },
});

export const discoverApps = internalQuery({
  args: {
    passportToken: v.string(),
    passportSecret: v.string(),
    now: v.number(),
  },
  returns: v.union(
    v.object({
      ok: v.literal(true),
      expiresAt: v.number(),
      apps: v.array(
        v.object({
          app: appValidator,
          status: v.union(v.literal("on"), v.literal("off")),
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
    return {
      ok: true as const,
      expiresAt: slice.expiresAt,
      apps: ALL_APPS.map((app) => ({
        app,
        status: slice.apps.includes(app) ? ("on" as const) : ("off" as const),
      })),
    };
  },
});
