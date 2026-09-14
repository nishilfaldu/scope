import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";
import { internalQuery, query, type QueryCtx } from "../../_generated/server";
import type { Doc } from "../../_generated/dataModel";
import { appValidator, ALL_APPS } from "../../permissions";
import schema from "../../schema";
import {
  lastEventValidator,
  latestEvent,
} from "../auditEvents/helpers";
import { hashesEqual, sha256Hex } from "../../secrets";
import {
  denyResultValidator,
  UNAUTHORIZED_ERROR,
} from "../../agentErrors";

const passportDoc = schema.doc("passports");
const boardPassport = passportDoc.omit("invokeKeyHash").extend({
  lastEvent: v.union(lastEventValidator, v.null()),
});

function withoutInvokeKey(passport: Doc<"passports">) {
  return {
    _id: passport._id,
    _creationTime: passport._creationTime,
    name: passport.name,
    token: passport.token,
    status: passport.status,
    expiresAt: passport.expiresAt,
    apps: passport.apps,
    auditSeq: passport.auditSeq,
    auditHeadHash: passport.auditHeadHash,
  };
}

export const list = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(boardPassport),
  handler: async (ctx, args) => {
    const results = await ctx.db
      .query("passports")
      .order("desc")
      .paginate(args.paginationOpts);
    const page = [];
    for (const passport of results.page) {
      page.push({
        ...withoutInvokeKey(passport),
        lastEvent: await latestEvent(ctx, passport._id),
      });
    }
    return { ...results, page };
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
    return {
      ...withoutInvokeKey(passport),
      lastEvent: await latestEvent(ctx, passport._id),
    };
  },
});

async function passportByInvokeKey(
  ctx: QueryCtx,
  args: { token: string; invokeKey: string },
): Promise<Doc<"passports"> | null> {
  const passport = await ctx.db
    .query("passports")
    .withIndex("by_token", (q) => q.eq("token", args.token))
    .unique();
  if (!passport?.invokeKeyHash) {
    return null;
  }
  const invokeHash = await sha256Hex(args.invokeKey);
  if (!hashesEqual(invokeHash, passport.invokeKeyHash)) {
    return null;
  }
  return passport;
}

export const getByCredentials = internalQuery({
  args: { token: v.string(), invokeKey: v.string() },
  returns: v.union(passportDoc, v.null()),
  handler: async (ctx, args) => {
    return await passportByInvokeKey(ctx, args);
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
