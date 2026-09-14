import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";
import {
  accountAppValidator,
  isAccountAppId,
  providerForApp,
  providerValidator,
} from "../../permissions";
import {
  denyResultValidator,
  APP_UNAVAILABLE_ERROR,
  UNAUTHORIZED_ERROR,
} from "../../agentErrors";
import { hashesEqual, sha256Hex } from "../../secrets";
import { denyCreate } from "./helpers";

export const APP_TOKEN_TTL_MS = 15 * 60 * 1000;

export const authorizeCreate = internalMutation({
  args: {
    passportToken: v.string(),
    passportSecret: v.string(),
    app: v.string(),
    refresh: v.boolean(),
  },
  returns: v.union(
    v.object({
      ok: v.literal(true),
      passportId: v.id("passports"),
      app: accountAppValidator,
      provider: providerValidator,
      refresh: v.boolean(),
    }),
    denyResultValidator,
  ),
  handler: async (ctx, args) => {
    const now = Date.now();
    const passport = await ctx.db
      .query("passports")
      .withIndex("by_token", (q) => q.eq("token", args.passportToken))
      .unique();
    if (!passport) {
      return {
        ok: false as const,
        status: 401,
        reason: UNAUTHORIZED_ERROR,
        code: "UNAUTHORIZED" as const,
      };
    }

    if (!passport.passportSecretHash) {
      return denyCreate(401, UNAUTHORIZED_ERROR, "UNAUTHORIZED");
    }
    const secretHash = await sha256Hex(args.passportSecret);
    if (!hashesEqual(secretHash, passport.passportSecretHash)) {
      return denyCreate(401, UNAUTHORIZED_ERROR, "UNAUTHORIZED");
    }

    if (!isAccountAppId(args.app)) {
      return denyCreate(403, APP_UNAVAILABLE_ERROR, "APP_UNAVAILABLE");
    }
    const app = args.app;
    const provider = providerForApp(app);

    if (passport.status === "revoked") {
      return denyCreate(403, "Passport revoked", "REVOKED");
    }
    if (passport.status === "expired" || passport.expiresAt <= now) {
      return denyCreate(403, "Passport expired", "EXPIRED");
    }
    if (!passport.apps.includes(app)) {
      return denyCreate(403, APP_UNAVAILABLE_ERROR, "APP_UNAVAILABLE");
    }

    const connection = await ctx.db
      .query("connections")
      .withIndex("by_provider", (q) => q.eq("provider", provider))
      .unique();
    if (!connection) {
      return denyCreate(403, APP_UNAVAILABLE_ERROR, "APP_UNAVAILABLE");
    }

    return {
      ok: true as const,
      passportId: passport._id,
      app,
      provider,
      refresh: args.refresh,
    };
  },
});

export const commitCreate = internalMutation({
  args: {
    passportId: v.id("passports"),
    app: accountAppValidator,
    expiresAt: v.number(),
    refresh: v.boolean(),
  },
  returns: v.object({
    expiresAt: v.number(),
  }),
  handler: async (_ctx, args) => {
    const now = Date.now();
    const expiresAt = Math.min(args.expiresAt, now + APP_TOKEN_TTL_MS);
    return { expiresAt };
  },
});
