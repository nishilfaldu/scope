import { v } from "convex/values";
import {
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { appValidator } from "./permissions";
import schema from "./schema";
import {
  appendAuditEvent,
  boardActorId,
  lastEventValidator,
  latestEvent,
  lifetimeStatus,
  markExpired,
} from "./audit";

const passportDoc = schema.doc("passports");
const boardPassport = passportDoc.extend({
  lifetimeStatus: v.union(
    v.literal("active"),
    v.literal("revoked"),
    v.literal("expired"),
  ),
  lastEvent: v.union(lastEventValidator, v.null()),
});

function randomPassportToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return `pp_${hex}`;
}

export const list = query({
  args: { now: v.number() },
  returns: v.array(boardPassport),
  handler: async (ctx, args) => {
    const [active, revoked, expired] = await Promise.all([
      ctx.db
        .query("passports")
        .withIndex("by_status", (q) => q.eq("status", "active"))
        .take(100),
      ctx.db
        .query("passports")
        .withIndex("by_status", (q) => q.eq("status", "revoked"))
        .take(100),
      ctx.db
        .query("passports")
        .withIndex("by_status", (q) => q.eq("status", "expired"))
        .take(100),
    ]);
    const rows = [...active, ...revoked, ...expired];
    const result = [];
    for (const passport of rows) {
      result.push({
        ...passport,
        lifetimeStatus: lifetimeStatus(passport, args.now),
        lastEvent: await latestEvent(ctx, passport._id),
      });
    }
    const rank = { active: 0, expired: 1, revoked: 2 } as const;
    result.sort(
      (a, b) =>
        rank[a.lifetimeStatus] - rank[b.lifetimeStatus] ||
        b._creationTime - a._creationTime,
    );
    return result;
  },
});

export const get = query({
  args: { passportId: v.string(), now: v.number() },
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
      ...passport,
      lifetimeStatus: lifetimeStatus(passport, args.now),
      lastEvent: await latestEvent(ctx, passport._id),
    };
  },
});

export const mint = mutation({
  args: {
    name: v.string(),
    ttlMs: v.number(),
    apps: v.array(appValidator),
  },
  returns: v.object({
    id: v.id("passports"),
    passportId: v.string(),
    expiresAt: v.number(),
    name: v.string(),
    apps: v.array(appValidator),
  }),
  handler: async (ctx, args) => {
    const name = args.name.trim();
    if (name.length === 0) {
      throw new Error("Name must be non-empty");
    }
    if (!Number.isFinite(args.ttlMs) || args.ttlMs <= 0) {
      throw new Error("ttlMs must be a positive number");
    }
    const uniqueApps = [...new Set(args.apps)];
    if (uniqueApps.length === 0) {
      throw new Error("Turn on at least one app");
    }

    const token = randomPassportToken();
    const expiresAt = Date.now() + args.ttlMs;
    const id = await ctx.db.insert("passports", {
      name,
      token,
      status: "active",
      expiresAt,
      apps: uniqueApps,
      auditSeq: 0,
    });
    const actorId = await boardActorId(ctx);
    await appendAuditEvent(ctx, {
      passportId: id,
      kind: "issued",
      actorType: "board",
      actorId,
      scopes: uniqueApps,
      outcome: "allowed",
      reason: "Passport minted",
      service: "board",
      action: null,
      argsPreview: null,
      httpStatus: null,
      occurredAt: Date.now(),
    });

    return {
      id,
      passportId: token,
      expiresAt,
      name,
      apps: uniqueApps,
    };
  },
});

export const revoke = mutation({
  args: { passportId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const passport = await ctx.db
      .query("passports")
      .withIndex("by_token", (q) => q.eq("token", args.passportId))
      .unique();
    if (!passport) {
      throw new Error("Passport not found");
    }
    if (passport.status === "revoked") {
      return null;
    }
    const now = Date.now();
    if (passport.status === "active" && passport.expiresAt <= now) {
      await markExpired(ctx, passport, now);
    }
    const actorId = await boardActorId(ctx);
    await ctx.db.patch("passports", passport._id, { status: "revoked" });
    await appendAuditEvent(ctx, {
      passportId: passport._id,
      kind: "revoked",
      actorType: "board",
      actorId,
      scopes: [...passport.apps],
      outcome: "allowed",
      reason: "Revoked by board",
      service: "board",
      action: null,
      argsPreview: null,
      httpStatus: null,
      occurredAt: Date.now(),
    });
    return null;
  },
});

export const getByToken = internalQuery({
  args: { token: v.string() },
  returns: v.union(passportDoc, v.null()),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("passports")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();
  },
});
