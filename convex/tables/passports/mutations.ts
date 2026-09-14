import { v } from "convex/values";
import type { Doc } from "../../_generated/dataModel";
import { internalMutation, mutation, type MutationCtx } from "../../_generated/server";
import { appValidator } from "../../permissions";
import { randomSecret, sha256Hex } from "../../secrets";

export const MAX_PASSPORT_NAME = 80;
export const MAX_TTL_MS = 7 * 24 * 60 * 60 * 1000;

async function markExpired(
  ctx: MutationCtx,
  passport: Doc<"passports">,
): Promise<void> {
  if (passport.status !== "active") return;
  await ctx.db.patch("passports", passport._id, { status: "expired" });
}

export const expireDue = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const now = Date.now();
    const due = await ctx.db
      .query("passports")
      .withIndex("by_status_and_expiresAt", (q) =>
        q.eq("status", "active").lte("expiresAt", now),
      )
      .take(25);
    for (const passport of due) {
      await markExpired(ctx, passport);
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

export const setApp = mutation({
  args: {
    passportId: v.string(),
    app: appValidator,
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
      await markExpired(ctx, passport);
      throw new Error("Passport expired");
    }
    if (passport.status !== "active") {
      throw new Error("Passport is not live");
    }
    const enabled = passport.apps.includes(args.app);
    if (enabled === args.enabled) {
      return null;
    }
    const apps = args.enabled
      ? [...passport.apps, args.app]
      : passport.apps.filter((app) => app !== args.app);
    await ctx.db.patch("passports", passport._id, { apps });
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
      await markExpired(ctx, passport);
    }
    await ctx.db.patch("passports", passport._id, { status: "revoked" });
    return null;
  },
});
