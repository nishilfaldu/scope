import { v } from "convex/values";
import type { Id } from "../../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../../_generated/server";
import { appendAuditEvent } from "../auditEvents/helpers";
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
  type AgentErrorCode,
} from "../../agentErrors";
import { hashesEqual, sha256Hex } from "../../secrets";

export const APP_TOKEN_TTL_MS = 15 * 60 * 1000;

async function denyCreate(
  ctx: MutationCtx,
  passportId: Id<"passports"> | null,
  app: string,
  status: number,
  reason: string,
  code: AgentErrorCode,
  now: number,
): Promise<{
  ok: false;
  status: number;
  reason: string;
  code: AgentErrorCode;
}> {
  if (passportId) {
    await appendAuditEvent(ctx, {
      passportId,
      kind: "create_denied",
      actorType: "agent",
      actorId: "credentials",
      scopes: [app],
      outcome: "denied",
      reason,
      service: "credentials",
      action: null,
      argsPreview: null,
      httpStatus: status,
      app,
      occurredAt: now,
    });
  }
  return { ok: false, status, reason, code };
}

export const authorizeCreate = internalMutation({
  args: {
    passportToken: v.string(),
    invokeKey: v.string(),
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

    if (!passport.invokeKeyHash) {
      return await denyCreate(
        ctx,
        passport._id,
        args.app,
        401,
        UNAUTHORIZED_ERROR,
        "UNAUTHORIZED",
        now,
      );
    }
    const invokeHash = await sha256Hex(args.invokeKey);
    if (!hashesEqual(invokeHash, passport.invokeKeyHash)) {
      return await denyCreate(
        ctx,
        passport._id,
        args.app,
        401,
        UNAUTHORIZED_ERROR,
        "UNAUTHORIZED",
        now,
      );
    }

    if (!isAccountAppId(args.app)) {
      return await denyCreate(
        ctx,
        passport._id,
        args.app,
        403,
        APP_UNAVAILABLE_ERROR,
        "APP_UNAVAILABLE",
        now,
      );
    }
    const app = args.app;
    const provider = providerForApp(app);

    if (passport.status === "revoked") {
      return await denyCreate(
        ctx,
        passport._id,
        app,
        403,
        "Passport revoked",
        "REVOKED",
        now,
      );
    }
    if (passport.status === "expired" || passport.expiresAt <= now) {
      return await denyCreate(
        ctx,
        passport._id,
        app,
        403,
        "Passport expired",
        "EXPIRED",
        now,
      );
    }
    if (!passport.apps.includes(app)) {
      return await denyCreate(
        ctx,
        passport._id,
        app,
        403,
        APP_UNAVAILABLE_ERROR,
        "APP_UNAVAILABLE",
        now,
      );
    }

    const connection = await ctx.db
      .query("connections")
      .withIndex("by_provider", (q) => q.eq("provider", provider))
      .unique();
    if (!connection) {
      return await denyCreate(
        ctx,
        passport._id,
        app,
        403,
        APP_UNAVAILABLE_ERROR,
        "APP_UNAVAILABLE",
        now,
      );
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
  handler: async (ctx, args) => {
    const now = Date.now();
    const expiresAt = Math.min(args.expiresAt, now + APP_TOKEN_TTL_MS);
    await appendAuditEvent(ctx, {
      passportId: args.passportId,
      kind: args.refresh ? "token_refreshed" : "token_issued",
      actorType: "agent",
      actorId: "credentials",
      scopes: [args.app],
      outcome: "allowed",
      reason: args.refresh
        ? "Short-lived token refreshed"
        : "Short-lived token issued",
      service: "credentials",
      action: null,
      argsPreview: null,
      httpStatus: 200,
      app: args.app,
      occurredAt: now,
    });
    return { expiresAt };
  },
});

export const logCreateDenied = internalMutation({
  args: {
    passportId: v.id("passports"),
    app: v.string(),
    reason: v.string(),
    httpStatus: v.union(v.number(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await appendAuditEvent(ctx, {
      passportId: args.passportId,
      app: args.app,
      kind: "create_denied",
      actorType: "agent",
      actorId: "credentials",
      scopes: [args.app],
      outcome: "denied",
      reason: args.reason,
      service: "credentials",
      action: null,
      argsPreview: null,
      httpStatus: args.httpStatus,
      occurredAt: Date.now(),
    });
    return null;
  },
});
