import { v } from "convex/values";
import { mutation } from "../../_generated/server";
import { appValidator } from "../../permissions";
import {
  appendAuditEvent,
  boardActorId,
  markExpired,
} from "../auditEvents/helpers";
import { randomSecret, sha256Hex } from "../../secrets";

export const MAX_PASSPORT_NAME = 80;
export const MAX_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const create = mutation({
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
    if (name.length > MAX_PASSPORT_NAME) {
      throw new Error("Name must be 80 characters or fewer");
    }
    if (!Number.isFinite(args.ttlMs) || args.ttlMs <= 0) {
      throw new Error("ttlMs must be a positive number");
    }
    if (args.ttlMs > MAX_TTL_MS) {
      throw new Error("ttlMs must be 7 days or fewer");
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
      reason: "Passport created",
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
