import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";
import {
  isAppId,
  appValidator,
  providerForApp,
  providerValidator,
} from "../../domain/apps";
import {
  denyResultValidator,
  APP_UNAVAILABLE_ERROR,
  UNAUTHORIZED_ERROR,
} from "../../lib/errors";
import { hashesEqual, sha256Hex } from "../../lib/secrets";
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
      sliceId: v.id("slices"),
      app: appValidator,
      provider: providerValidator,
      refresh: v.boolean(),
    }),
    denyResultValidator,
  ),
  handler: async (ctx, args) => {
    const now = Date.now();
    const slice = await ctx.db
      .query("slices")
      .withIndex("by_token", (q) => q.eq("token", args.passportToken))
      .unique();
    if (!slice) {
      return {
        ok: false as const,
        status: 401,
        reason: UNAUTHORIZED_ERROR,
        code: "UNAUTHORIZED" as const,
      };
    }

    if (!slice.secretHash) {
      return denyCreate(401, UNAUTHORIZED_ERROR, "UNAUTHORIZED");
    }
    const secretHash = await sha256Hex(args.passportSecret);
    if (!hashesEqual(secretHash, slice.secretHash)) {
      return denyCreate(401, UNAUTHORIZED_ERROR, "UNAUTHORIZED");
    }

    if (!isAppId(args.app)) {
      return denyCreate(403, APP_UNAVAILABLE_ERROR, "APP_UNAVAILABLE");
    }
    const app = args.app;
    const provider = providerForApp(app);

    if (slice.status === "revoked") {
      return denyCreate(403, "Passport revoked", "REVOKED");
    }
    if (slice.status === "expired" || slice.expiresAt <= now) {
      return denyCreate(403, "Passport expired", "EXPIRED");
    }
    if (!slice.apps.includes(app)) {
      return denyCreate(403, APP_UNAVAILABLE_ERROR, "APP_UNAVAILABLE");
    }

    let connection = await ctx.db
      .query("connections")
      .withIndex("by_passport_and_provider", (q) =>
        q.eq("passportId", slice.passportId).eq("provider", provider),
      )
      .unique();
    if (!connection) {
      // Connections saved before passports existed have no owner. The first
      // slice to use one claims it for its passport.
      const legacy = await ctx.db
        .query("connections")
        .withIndex("by_provider", (q) => q.eq("provider", provider))
        .unique();
      if (legacy) {
        await ctx.db.patch("connections", legacy._id, {
          passportId: slice.passportId,
        });
        connection = legacy;
      }
    }
    if (!connection) {
      return denyCreate(403, APP_UNAVAILABLE_ERROR, "APP_UNAVAILABLE");
    }

    return {
      ok: true as const,
      sliceId: slice._id,
      app,
      provider,
      refresh: args.refresh,
    };
  },
});

export const commitCreate = internalMutation({
  args: {
    sliceId: v.id("slices"),
    app: appValidator,
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
