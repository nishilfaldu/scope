import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";
import { internalQuery, query } from "../../_generated/server";
import { appValidator, ALL_APPS } from "../../permissions";
import schema from "../../schema";
import {
  denyResultValidator,
  UNAUTHORIZED_ERROR,
} from "../../agentErrors";
import { passportByInvokeKey, withoutInvokeKey } from "./helpers";

const passportDoc = schema.doc("passports");
const boardPassport = passportDoc.omit("invokeKeyHash");

export const list = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(boardPassport),
  handler: async (ctx, args) => {
    const results = await ctx.db
      .query("passports")
      .order("desc")
      .paginate(args.paginationOpts);
    return {
      ...results,
      page: results.page.map(withoutInvokeKey),
    };
  },
});

export const get = query({
  args: { passportId: v.string() },
  returns: v.union(boardPassport, v.null()),
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("passports", args.passportId);
    if (!id) {
      return null;
    }
    const passport = await ctx.db.get("passports", id);
    if (!passport) {
      return null;
    }
    return withoutInvokeKey(passport);
  },
});

export const discoverApps = internalQuery({
  args: {
    token: v.string(),
    invokeKey: v.string(),
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
    const passport = await passportByInvokeKey(ctx, args);
    if (!passport) {
      return {
        ok: false as const,
        status: 401,
        reason: UNAUTHORIZED_ERROR,
        code: "UNAUTHORIZED" as const,
      };
    }
    if (passport.status === "revoked") {
      return {
        ok: false as const,
        status: 403,
        reason: "Passport revoked",
        code: "REVOKED" as const,
      };
    }
    if (passport.status === "expired" || passport.expiresAt <= args.now) {
      return {
        ok: false as const,
        status: 403,
        reason: "Passport expired",
        code: "EXPIRED" as const,
      };
    }
    return {
      ok: true as const,
      expiresAt: passport.expiresAt,
      apps: ALL_APPS.map((app) => ({
        app,
        status: passport.apps.includes(app) ? ("on" as const) : ("off" as const),
      })),
    };
  },
});
