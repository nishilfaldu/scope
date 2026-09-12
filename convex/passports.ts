import { v } from "convex/values";
import {
  internalQuery,
  mutation,
  query,
  type QueryCtx,
} from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { appValidator, ALL_APPS } from "./permissions";
import schema from "./schema";
import {
  appendAuditEvent,
  boardActorId,
  lastEventValidator,
  latestEvent,
  lifetimeStatus,
  markExpired,
} from "./audit";
import { hashesEqual, randomSecret, sha256Hex } from "./secrets";
import { revokeLivePlatformTokens } from "./tokens";
import {
  denyResultValidator,
  UNAUTHORIZED_ERROR,
} from "./agentErrors";

const passportDoc = schema.doc("passports");
const boardPassport = passportDoc.omit("invokeKeyHash").extend({
  lifetimeStatus: v.union(
    v.literal("active"),
    v.literal("revoked"),
    v.literal("expired"),
  ),
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
        ...withoutInvokeKey(passport),
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
      ...withoutInvokeKey(passport),
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
    invokeKey: v.string(),
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

    const token = randomSecret("pp_");
    const invokeKey = randomSecret("ik_");
    const invokeKeyHash = await sha256Hex(invokeKey);
    const expiresAt = Date.now() + args.ttlMs;
    const id = await ctx.db.insert("passports", {
      name,
      token,
      invokeKeyHash,
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
      platform: null,
      occurredAt: Date.now(),
    });

    return {
      id,
      passportId: token,
      invokeKey,
      expiresAt,
      name,
      apps: uniqueApps,
    };
  },
});

export const setPlatform = mutation({
  args: {
    passportId: v.string(),
    platform: appValidator,
    enabled: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const passport = await ctx.db
      .query("passports")
      .withIndex("by_token", (q) => q.eq("token", args.passportId))
      .unique();
    if (!passport) {
      throw new Error("Passport not found");
    }
    const now = Date.now();
    if (passport.status === "active" && passport.expiresAt <= now) {
      await markExpired(ctx, passport, now);
      throw new Error("Passport expired");
    }
    if (passport.status !== "active") {
      throw new Error("Passport is not live");
    }
    const enabled = passport.apps.includes(args.platform);
    if (enabled === args.enabled) {
      return null;
    }
    const apps = args.enabled
      ? [...passport.apps, args.platform]
      : passport.apps.filter((app) => app !== args.platform);
    await ctx.db.patch("passports", passport._id, { apps });
    const actorId = await boardActorId(ctx);
    if (!args.enabled) {
      await revokeLivePlatformTokens(
        ctx,
        passport._id,
        args.platform,
        "Platform turned off",
        now,
        { actorType: "board", actorId },
      );
    }
    await appendAuditEvent(ctx, {
      passportId: passport._id,
      kind: "platform_toggled",
      actorType: "board",
      actorId,
      scopes: [args.platform],
      outcome: "allowed",
      reason: args.enabled
        ? `Enabled ${args.platform}`
        : `Disabled ${args.platform}`,
      service: "board",
      action: args.platform,
      argsPreview: null,
      httpStatus: null,
      platform: args.platform,
      occurredAt: Date.now(),
    });
    return null;
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
    await revokeLivePlatformTokens(
      ctx,
      passport._id,
      null,
      "Passport revoked",
      now,
      { actorType: "board", actorId },
    );
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
      platform: null,
      occurredAt: Date.now(),
    });
    return null;
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

export const discoverPlatforms = internalQuery({
  args: {
    token: v.string(),
    invokeKey: v.string(),
    now: v.number(),
  },
  returns: v.union(
    v.object({
      ok: v.literal(true),
      expiresAt: v.number(),
      platforms: v.array(
        v.object({
          platform: appValidator,
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
        code: "unauthorized" as const,
      };
    }
    if (passport.status === "revoked") {
      return {
        ok: false as const,
        status: 403,
        reason: "Passport revoked",
        code: "revoked" as const,
      };
    }
    if (passport.status === "expired" || passport.expiresAt <= args.now) {
      return {
        ok: false as const,
        status: 403,
        reason: "Passport expired",
        code: "expired" as const,
      };
    }
    return {
      ok: true as const,
      expiresAt: passport.expiresAt,
      platforms: ALL_APPS.map((platform) => ({
        platform,
        status: passport.apps.includes(platform) ? ("on" as const) : ("off" as const),
      })),
    };
  },
});
