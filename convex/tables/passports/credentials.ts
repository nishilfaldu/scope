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
  PLATFORM_UNAVAILABLE_ERROR,
  UNAUTHORIZED_ERROR,
  type AgentErrorCode,
} from "../../agentErrors";
import { hashesEqual, sha256Hex } from "../../secrets";

export const PLATFORM_TOKEN_TTL_MS = 15 * 60 * 1000;

async function denyCreate(
  ctx: MutationCtx,
  passportId: Id<"passports"> | null,
  platform: string,
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
      scopes: [platform],
      outcome: "denied",
      reason,
      service: "credentials",
      action: null,
      argsPreview: null,
      httpStatus: status,
      platform,
      occurredAt: now,
    });
  }
  return { ok: false, status, reason, code };
}

export const authorizeCreate = internalMutation({
  args: {
    passportToken: v.string(),
    invokeKey: v.string(),
    platform: v.string(),
    refresh: v.boolean(),
  },
  returns: v.union(
    v.object({
      ok: v.literal(true),
      passportId: v.id("passports"),
      platform: accountAppValidator,
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
        args.platform,
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
        args.platform,
        401,
        UNAUTHORIZED_ERROR,
        "UNAUTHORIZED",
        now,
      );
    }

    if (!isAccountAppId(args.platform)) {
      return await denyCreate(
        ctx,
        passport._id,
        args.platform,
        403,
        PLATFORM_UNAVAILABLE_ERROR,
        "PLATFORM_UNAVAILABLE",
        now,
      );
    }
    const platform = args.platform;
    const provider = providerForApp(platform);

    if (passport.status === "revoked") {
      return await denyCreate(
        ctx,
        passport._id,
        platform,
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
        platform,
        403,
        "Passport expired",
        "EXPIRED",
        now,
      );
    }
    if (!passport.apps.includes(platform)) {
      return await denyCreate(
        ctx,
        passport._id,
        platform,
        403,
        PLATFORM_UNAVAILABLE_ERROR,
        "PLATFORM_UNAVAILABLE",
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
        platform,
        403,
        PLATFORM_UNAVAILABLE_ERROR,
        "PLATFORM_UNAVAILABLE",
        now,
      );
    }

    return {
      ok: true as const,
      passportId: passport._id,
      platform,
      provider,
      refresh: args.refresh,
    };
  },
});

export const commitCreate = internalMutation({
  args: {
    passportId: v.id("passports"),
    platform: accountAppValidator,
    expiresAt: v.number(),
    refresh: v.boolean(),
  },
  returns: v.object({
    expiresAt: v.number(),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const expiresAt = Math.min(args.expiresAt, now + PLATFORM_TOKEN_TTL_MS);
    await appendAuditEvent(ctx, {
      passportId: args.passportId,
      kind: args.refresh ? "token_refreshed" : "token_issued",
      actorType: "agent",
      actorId: "credentials",
      scopes: [args.platform],
      outcome: "allowed",
      reason: args.refresh
        ? "Short-lived token refreshed"
        : "Short-lived token issued",
      service: "credentials",
      action: null,
      argsPreview: null,
      httpStatus: 200,
      platform: args.platform,
      occurredAt: now,
    });
    return { expiresAt };
  },
});

export const logCreateDenied = internalMutation({
  args: {
    passportId: v.id("passports"),
    platform: v.string(),
    reason: v.string(),
    httpStatus: v.union(v.number(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await appendAuditEvent(ctx, {
      passportId: args.passportId,
      platform: args.platform,
      kind: "create_denied",
      actorType: "agent",
      actorId: "credentials",
      scopes: [args.platform],
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
