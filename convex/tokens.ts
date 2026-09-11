import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { markExpired } from "./audit";
import { type TokenLogKind } from "./auditFields";
import {
  accountAppValidator,
  isAccountAppId,
  isAppId,
  providerForApp,
  providerValidator,
  type AccountAppId,
  type ProviderId,
} from "./permissions";
import schema from "./schema";
import { hashesEqual, sha256Hex } from "./secrets";

export const PLATFORM_TOKEN_TTL_MS = 15 * 60 * 1000;

const liveTokenValidator = v.object({
  platform: accountAppValidator,
  status: v.literal("live"),
  expiresAt: v.number(),
});

const tokenLogDoc = schema.doc("tokenLogs");

export async function appendTokenLog(
  ctx: MutationCtx,
  input: {
    passportId: Id<"passports">;
    platform: string;
    kind: TokenLogKind;
    reason: string;
    occurredAt: number;
  },
): Promise<void> {
  await ctx.db.insert("tokenLogs", input);
}

export async function revokeLivePlatformTokens(
  ctx: MutationCtx,
  passportId: Id<"passports">,
  platform: AccountAppId | null,
  reason: string,
  now: number,
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
    await appendTokenLog(ctx, {
      passportId,
      platform: token.platform,
      kind: "revoked",
      reason,
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
  now: number,
): Promise<{ ok: false; status: number; reason: string }> {
  if (passportId) {
    await appendTokenLog(ctx, {
      passportId,
      platform,
      kind: "mint_denied",
      reason,
      occurredAt: now,
    });
  }
  return { ok: false, status, reason };
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
    }),
    v.object({
      ok: v.literal(false),
      status: v.number(),
      reason: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const now = Date.now();
    const passport = await ctx.db
      .query("passports")
      .withIndex("by_token", (q) => q.eq("token", args.passportToken))
      .unique();
    if (!passport) {
      return { ok: false as const, status: 401, reason: "Unknown passport" };
    }

    let current = passport;
    if (current.status === "active" && current.expiresAt <= now) {
      current = await markExpired(ctx, current, now);
    }

    if (!current.invokeKeyHash) {
      return await denyMint(
        ctx,
        current._id,
        args.platform,
        401,
        "Passport has no invoke key; mint a new passport",
        now,
      );
    }
    const invokeHash = await sha256Hex(args.invokeKey);
    if (!hashesEqual(invokeHash, current.invokeKeyHash)) {
      return await denyMint(
        ctx,
        current._id,
        args.platform,
        401,
        "Invalid invoke key",
        now,
      );
    }

    if (!isAppId(args.platform) || !isAccountAppId(args.platform)) {
      return await denyMint(
        ctx,
        current._id,
        args.platform,
        400,
        "Unknown platform",
        now,
      );
    }
    const platform = args.platform;
    const provider: ProviderId | null = providerForApp(platform);
    if (provider === null) {
      return await denyMint(
        ctx,
        current._id,
        platform,
        400,
        "Demo has no platform token; use /api/invoke",
        now,
      );
    }

    if (current.status === "revoked") {
      return await denyMint(
        ctx,
        current._id,
        platform,
        403,
        "Passport revoked",
        now,
      );
    }
    if (current.status === "expired" || current.expiresAt <= now) {
      return await denyMint(
        ctx,
        current._id,
        platform,
        403,
        "Passport expired",
        now,
      );
    }
    if (!current.apps.includes(platform)) {
      return await denyMint(
        ctx,
        current._id,
        platform,
        403,
        "Platform is off",
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
        current._id,
        platform,
        403,
        `${provider} is not connected`,
        now,
      );
    }

    return {
      ok: true as const,
      passportId: current._id,
      platform,
      provider,
      refresh: args.refresh,
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
    );
    const expiresAt = Math.min(args.expiresAt, now + PLATFORM_TOKEN_TTL_MS);
    await ctx.db.insert("platformTokens", {
      passportId: args.passportId,
      platform: args.platform,
      accessToken: args.accessToken,
      status: "live",
      expiresAt,
    });
    await appendTokenLog(ctx, {
      passportId: args.passportId,
      platform: args.platform,
      kind: args.refresh ? "refreshed" : "issued",
      reason: args.refresh
        ? "Short-lived token refreshed"
        : "Short-lived token issued",
      occurredAt: now,
    });
    return { expiresAt, revokedPrevious: revokedCount > 0 };
  },
});

export const logMintDenied = internalMutation({
  args: {
    passportId: v.id("passports"),
    platform: v.string(),
    reason: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await appendTokenLog(ctx, {
      passportId: args.passportId,
      platform: args.platform,
      kind: "mint_denied",
      reason: args.reason,
      occurredAt: Date.now(),
    });
    return null;
  },
});

export const revokeForPassport = internalMutation({
  args: {
    passportId: v.id("passports"),
    platform: v.union(accountAppValidator, v.null()),
    reason: v.string(),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    return await revokeLivePlatformTokens(
      ctx,
      args.passportId,
      args.platform,
      args.reason,
      Date.now(),
    );
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

export const listLogs = query({
  args: {
    passportId: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(tokenLogDoc),
  handler: async (ctx, args) => {
    const empty = {
      page: [] as Doc<"tokenLogs">[],
      isDone: true,
      continueCursor: "",
    };
    const id = ctx.db.normalizeId("passports", args.passportId);
    if (!id) {
      return empty;
    }
    return await ctx.db
      .query("tokenLogs")
      .withIndex("by_passport", (q) => q.eq("passportId", id))
      .order("desc")
      .paginate(args.paginationOpts);
  },
});
