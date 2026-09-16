import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";
import { authenticatedMutation } from "../../functions";
import { appValidator, providerForApp } from "../../domain/apps";
import { randomSecret, sha256Hex } from "../../lib/secrets";
import { markExpired } from "./helpers";

export const MAX_SLICE_NAME = 80;
export const MAX_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const mintPolicyValidator = v.union(v.literal("auto"), v.literal("approve"));

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

export const create = authenticatedMutation({
  args: {
    name: v.string(),
    ttlMs: v.number(),
    apps: v.array(appValidator),
    mintPolicy: v.optional(mintPolicyValidator),
  },
  returns: v.object({
    id: v.id("slices"),
    sliceToken: v.string(),
    sliceSecret: v.string(),
    expiresAt: v.number(),
    name: v.string(),
    apps: v.array(appValidator),
    mintPolicy: mintPolicyValidator,
  }),
  handler: async (ctx, args) => {
    const { userId } = ctx;
    const name = args.name.trim();
    if (name.length === 0) {
      throw new Error("Name must be non-empty");
    }
    if (name.length > MAX_SLICE_NAME) {
      throw new Error("Name must be 80 characters or fewer");
    }
    if (!Number.isFinite(args.ttlMs) || args.ttlMs <= 0) {
      throw new Error("ttlMs must be a positive number");
    }
    if (args.ttlMs > MAX_TTL_MS) {
      throw new Error("ttlMs must be 7 days or fewer");
    }
    const mintPolicy: "auto" | "approve" =
      args.mintPolicy === "approve" ? "approve" : "auto";
    const uniqueApps = [...new Set(args.apps)];
    if (uniqueApps.length === 0) {
      throw new Error("Turn on at least one app");
    }
    const connections = await ctx.db
      .query("connections")
      .withIndex("by_user_and_provider", (q) => q.eq("userId", userId))
      .collect();
    if (connections.length === 0) {
      throw new Error(
        "Connect an account at /connections before creating a slice",
      );
    }
    const connectedProviders = new Set(
      connections.map((connection) => connection.provider),
    );
    const unavailable = uniqueApps.find(
      (app) => !connectedProviders.has(providerForApp(app)),
    );
    if (unavailable) {
      throw new Error(
        `Connect ${providerForApp(unavailable)} before allowing ${unavailable}`,
      );
    }

    const passport = await ctx.db
      .query("passports")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (!passport) {
      throw new Error("Passport not found for this account");
    }
    const passportId = passport._id;
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
      mintPolicy,
    });

    return {
      id,
      sliceToken: token,
      sliceSecret,
      expiresAt,
      name,
      apps: uniqueApps,
      mintPolicy,
    };
  },
});

export const setMintPolicy = authenticatedMutation({
  args: {
    sliceToken: v.string(),
    mintPolicy: mintPolicyValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { userId } = ctx;
    const slice = await ctx.db
      .query("slices")
      .withIndex("by_token", (q) => q.eq("token", args.sliceToken))
      .unique();
    if (!slice || slice.userId !== userId) {
      throw new Error("Slice not found");
    }
    if (slice.status !== "active") {
      throw new Error("Slice is not live");
    }
    await ctx.db.patch("slices", slice._id, { mintPolicy: args.mintPolicy });
    return null;
  },
});

export const setApp = authenticatedMutation({
  args: {
    sliceToken: v.string(),
    app: appValidator,
    enabled: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { userId } = ctx;
    const slice = await ctx.db
      .query("slices")
      .withIndex("by_token", (q) => q.eq("token", args.sliceToken))
      .unique();
    if (!slice || slice.userId !== userId) {
      throw new Error("Slice not found");
    }
    const now = Date.now();
    if (slice.status === "active" && slice.expiresAt <= now) {
      await markExpired(ctx, slice);
      throw new Error("Slice expired");
    }
    if (slice.status !== "active") {
      throw new Error("Slice is not live");
    }
    const grant = await ctx.db.get("grants", slice.grantId);
    if (!grant) {
      throw new Error("Grant not found");
    }
    const enabled = grant.apps.includes(args.app);
    if (enabled === args.enabled) {
      return null;
    }
    if (args.enabled) {
      const provider = providerForApp(args.app);
      const connection = await ctx.db
        .query("connections")
        .withIndex("by_user_and_provider", (q) =>
          q.eq("userId", userId).eq("provider", provider),
        )
        .unique();
      if (!connection) {
        throw new Error(`Connect ${provider} before allowing ${args.app}`);
      }
    }
    const apps = args.enabled
      ? [...grant.apps, args.app]
      : grant.apps.filter((app) => app !== args.app);
    await ctx.db.patch("grants", grant._id, { apps });
    return null;
  },
});

export const revoke = authenticatedMutation({
  args: { sliceToken: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { userId } = ctx;
    const slice = await ctx.db
      .query("slices")
      .withIndex("by_token", (q) => q.eq("token", args.sliceToken))
      .unique();
    if (!slice || slice.userId !== userId) {
      throw new Error("Slice not found");
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
