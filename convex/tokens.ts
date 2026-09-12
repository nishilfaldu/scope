import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import {
  internalMutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { appendAuditEvent } from "./auditWrite";
import { type ActorType } from "./auditFields";
import {
  accountAppValidator,
  isAccountAppId,
  providerForApp,
  providerValidator,
  type AccountAppId,
} from "./permissions";
import {
  denyResultValidator,
  PLATFORM_UNAVAILABLE_ERROR,
  UNAUTHORIZED_ERROR,
  type AgentErrorCode,
} from "./agentErrors";
import { hashesEqual, sha256Hex } from "./secrets";

export const PLATFORM_TOKEN_TTL_MS = 15 * 60 * 1000;
export const TOKEN_REUSE_MIN_REMAINING_MS = 30 * 1000;

const liveTokenValidator = v.object({
  platform: accountAppValidator,
  status: v.literal("live"),
  expiresAt: v.number(),
});

export async function revokeLivePlatformTokens(
  ctx: MutationCtx,
  passportId: Id<"passports">,
  platform: AccountAppId | null,
  reason: string,
  now: number,
  actor: { actorType: ActorType; actorId: string },
): Promise<number> {
  const live = await ctx.db
    .query("platformTokens")
    .withIndex("by_passport_and_status", (q) =>
      q.eq("passportId", passportId).eq("status", "live"),
    )
    .take(100);
  let count = 0;
  for (const token of live) {
    if (platform !== null && token.platform !== platform) {
      continue;
    }
    await ctx.db.patch("platformTokens", token._id, {
      status: "revoked",
      revokedAt: now,
      revokeReason: reason,
    });
    await appendAuditEvent(ctx, {
      passportId,
      kind: "token_revoked",
      actorType: actor.actorType,
      actorId: actor.actorId,
      scopes: [token.platform],
      outcome: "allowed",
      reason,
      service: "credentials",
      action: null,
      argsPreview: null,
      httpStatus: null,
      platform: token.platform,
      occurredAt: now,
    });
    count += 1;
  }
  return count;
}

async function denyMint(
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
      kind: "mint_denied",
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

export const authorizeMint = internalMutation({
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
      liveAccessToken: v.union(v.string(), v.null()),
      liveExpiresAt: v.union(v.number(), v.null()),
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
        code: "unauthorized" as const,
      };
    }

    if (!passport.invokeKeyHash) {
      return await denyMint(
        ctx,
        passport._id,
        args.platform,
        401,
        UNAUTHORIZED_ERROR,
        "unauthorized",
        now,
      );
    }
    const invokeHash = await sha256Hex(args.invokeKey);
    if (!hashesEqual(invokeHash, passport.invokeKeyHash)) {
      return await denyMint(
        ctx,
        passport._id,
        args.platform,
        401,
        UNAUTHORIZED_ERROR,
        "unauthorized",
        now,
      );
    }

    if (!isAccountAppId(args.platform)) {
      return await denyMint(
        ctx,
        passport._id,
        args.platform,
        403,
        PLATFORM_UNAVAILABLE_ERROR,
        "platform_unavailable",
        now,
      );
    }
    const platform = args.platform;
    const provider = providerForApp(platform);

    if (passport.status === "revoked") {
      return await denyMint(
        ctx,
        passport._id,
        platform,
        403,
        "Passport revoked",
        "revoked",
        now,
      );
    }
    if (passport.status === "expired" || passport.expiresAt <= now) {
      return await denyMint(
        ctx,
        passport._id,
        platform,
        403,
        "Passport expired",
        "expired",
        now,
      );
    }
    if (!passport.apps.includes(platform)) {
      return await denyMint(
        ctx,
        passport._id,
        platform,
        403,
        PLATFORM_UNAVAILABLE_ERROR,
        "platform_unavailable",
        now,
      );
    }

    const connection = await ctx.db
      .query("connections")
      .withIndex("by_provider", (q) => q.eq("provider", provider))
      .unique();
    if (!connection) {
      return await denyMint(
        ctx,
        passport._id,
        platform,
        403,
        PLATFORM_UNAVAILABLE_ERROR,
        "platform_unavailable",
        now,
      );
    }

    let liveAccessToken: string | null = null;
    let liveExpiresAt: number | null = null;
    if (!args.refresh) {
      const liveRows = await ctx.db
        .query("platformTokens")
        .withIndex("by_passport_and_platform", (q) =>
          q.eq("passportId", passport._id).eq("platform", platform),
        )
        .take(20);
      const live = liveRows.find(
        (token) =>
          token.status === "live" &&
          token.expiresAt > now + TOKEN_REUSE_MIN_REMAINING_MS,
      );
      if (live) {
        liveAccessToken = live.accessToken;
        liveExpiresAt = live.expiresAt;
      }
    }

    return {
      ok: true as const,
      passportId: passport._id,
      platform,
      provider,
      refresh: args.refresh,
      liveAccessToken,
      liveExpiresAt,
    };
  },
});

export const commitMint = internalMutation({
  args: {
    passportId: v.id("passports"),
    platform: accountAppValidator,
    accessToken: v.string(),
    expiresAt: v.number(),
    refresh: v.boolean(),
  },
  returns: v.object({
    expiresAt: v.number(),
    revokedPrevious: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const revokedCount = await revokeLivePlatformTokens(
      ctx,
      args.passportId,
      args.platform,
      args.refresh ? "Replaced by refresh" : "Replaced by new issue",
      now,
      { actorType: "agent", actorId: "credentials" },
    );
    const expiresAt = Math.min(args.expiresAt, now + PLATFORM_TOKEN_TTL_MS);
    await ctx.db.insert("platformTokens", {
      passportId: args.passportId,
      platform: args.platform,
      accessToken: args.accessToken,
      status: "live",
      expiresAt,
    });
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
    return { expiresAt, revokedPrevious: revokedCount > 0 };
  },
});

export async function expireStalePlatformTokens(
  ctx: MutationCtx,
  now: number,
): Promise<number> {
  const stale = await ctx.db
    .query("platformTokens")
    .withIndex("by_status_and_expiresAt", (q) =>
      q.eq("status", "live").lte("expiresAt", now),
    )
    .take(25);
  for (const token of stale) {
    await ctx.db.patch("platformTokens", token._id, {
      status: "revoked",
      revokedAt: now,
      revokeReason: "Time to live elapsed",
    });
    await appendAuditEvent(ctx, {
      passportId: token.passportId,
      kind: "token_revoked",
      actorType: "system",
      actorId: "expiry",
      scopes: [token.platform],
      outcome: "allowed",
      reason: "Time to live elapsed",
      service: "credentials",
      action: null,
      argsPreview: null,
      httpStatus: null,
      platform: token.platform,
      occurredAt: now,
    });
  }
  return stale.length;
}

export const logMintDenied = internalMutation({
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
      kind: "mint_denied",
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

export const listLive = query({
  args: { passportId: v.string(), now: v.number() },
  returns: v.array(liveTokenValidator),
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("passports", args.passportId);
    if (!id) {
      return [];
    }
    const live = await ctx.db
      .query("platformTokens")
      .withIndex("by_passport_and_status", (q) =>
        q.eq("passportId", id).eq("status", "live"),
      )
      .take(50);
    return live
      .filter((token) => token.expiresAt > args.now)
      .map((token) => ({
        platform: token.platform,
        status: "live" as const,
        expiresAt: token.expiresAt,
      }));
  },
});
