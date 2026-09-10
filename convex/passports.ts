import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { appValidator } from "./permissions";
import schema from "./schema";

const passportDoc = schema.doc("passports");

function randomPassportToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return `pp_${hex}`;
}

export const listActive = query({
  args: { now: v.number() },
  returns: v.array(passportDoc),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("passports")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .take(100);
    return rows.filter((row) => row.expiresAt > args.now);
  },
});

export const mint = mutation({
  args: {
    name: v.string(),
    ttlMs: v.number(),
    apps: v.array(appValidator),
  },
  returns: v.object({
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
    await ctx.db.insert("passports", {
      name,
      token,
      status: "active",
      expiresAt,
      apps: uniqueApps,
      lastError: null,
    });

    return {
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
    await ctx.db.patch("passports", passport._id, { status: "revoked" });
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

export const recordLastAction = internalMutation({
  args: {
    passportId: v.string(),
    lastAction: v.string(),
    lastActionOk: v.boolean(),
    lastError: v.union(v.string(), v.null()),
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
    await ctx.db.patch("passports", passport._id, {
      lastAction: args.lastAction,
      lastActionAt: Date.now(),
      lastActionOk: args.lastActionOk,
      lastError: args.lastError,
    });
    return null;
  },
});
