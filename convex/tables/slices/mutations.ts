import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internalMutation, mutation } from "../../_generated/server";
import { appValidator } from "../../domain/apps";
import { randomSecret, sha256Hex } from "../../lib/secrets";
import { markExpired } from "./helpers";

export const MAX_PASSPORT_NAME = 80;
export const MAX_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const expireDue = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const now = Date.now();
    const due = await ctx.db
      .query("slices")
      .withIndex("by_status_and_expiresAt", (q) =>
        q.eq("status", "active").lte("expiresAt", now),
      )
      .take(25);
    for (const slice of due) {
      await markExpired(ctx, slice);
    }
    return due.length;
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    ttlMs: v.number(),
    apps: v.array(appValidator),
  },
  returns: v.object({
    id: v.id("slices"),
    sliceToken: v.string(),
    sliceSecret: v.string(),
    expiresAt: v.number(),
    name: v.string(),
    apps: v.array(appValidator),
  }),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Sign in to create a passport");
    }
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

    const existingPassport = await ctx.db
      .query("passports")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    const passportId = existingPassport?._id ?? await ctx.db.insert("passports", {
      userId,
      name: "Default passport",
    });
    const expiresAt = Date.now() + args.ttlMs;
    const grantId = await ctx.db.insert("grants", {
      passportId,
      userId,
      agent: name,
      apps: uniqueApps,
      expiresAt,
    });

    const token = randomSecret("st_");
    const sliceSecret = randomSecret("ss_");
    const secretHash = await sha256Hex(sliceSecret);
    const id = await ctx.db.insert("slices", {
      passportId,
      grantId,
      userId,
      name,
      token,
      secretHash,
      status: "active",
      expiresAt,
    });

    return {
      id,
      sliceToken: token,
      sliceSecret,
      expiresAt,
      name,
      apps: uniqueApps,
    };
  },
});

export const setApp = mutation({
  args: {
    sliceToken: v.string(),
    app: appValidator,
    enabled: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const slice = await ctx.db
      .query("slices")
      .withIndex("by_token", (q) => q.eq("token", args.sliceToken))
      .unique();
    if (!slice) {
      throw new Error("Passport not found");
    }
    const now = Date.now();
    if (slice.status === "active" && slice.expiresAt <= now) {
      await markExpired(ctx, slice);
      throw new Error("Passport expired");
    }
    if (slice.status !== "active") {
      throw new Error("Passport is not live");
    }
    const grant = await ctx.db.get("grants", slice.grantId);
    if (!grant) {
      throw new Error("Grant not found");
    }
    const enabled = grant.apps.includes(args.app);
    if (enabled === args.enabled) {
      return null;
    }
    const apps = args.enabled
      ? [...grant.apps, args.app]
      : grant.apps.filter((app) => app !== args.app);
    await ctx.db.patch("grants", grant._id, { apps });
    return null;
  },
});

export const revoke = mutation({
  args: { sliceToken: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const slice = await ctx.db
      .query("slices")
      .withIndex("by_token", (q) => q.eq("token", args.sliceToken))
      .unique();
    if (!slice) {
      throw new Error("Passport not found");
    }
    if (slice.status === "revoked") {
      return null;
    }
    const now = Date.now();
    if (slice.status === "active" && slice.expiresAt <= now) {
      await markExpired(ctx, slice);
    }
    await ctx.db.patch("slices", slice._id, { status: "revoked" });
    return null;
  },
});
