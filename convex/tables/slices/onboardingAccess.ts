import { v } from "convex/values";
import { requestStatusValidator, effectiveRequestStatus } from "../../domain/requests";
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "../../_generated/server";
import {
  appValidator,
} from "../../domain/apps";
import {
  APPROVAL_DENIED_ERROR,
  APPROVAL_EXPIRED_ERROR,
  denyResultValidator,
} from "../../lib/errors";
import { decryptToken } from "../../lib/tokenEncryption";
import { randomSecret, sha256Hex } from "../../lib/secrets";
import { denyCreate, MAX_SLICE_APPS, MAX_SLICE_NAME, MAX_TTL_MS } from "./helpers";

export const ONBOARDING_PENDING_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_PENDING_ONBOARDING = 100;
export const MAX_REASON_LENGTH = 280;

export async function issuePublicPair() {
  const publicToken = randomSecret("ar_");
  const claimHandle = randomSecret("ch_");
  const claimSecretHash = await sha256Hex(claimHandle);
  return { publicToken, claimHandle, claimSecretHash };
}

export const createOnboarding = internalMutation({
  args: {
    agentName: v.string(),
    apps: v.array(appValidator),
    ttlMs: v.number(),
    reason: v.optional(v.string()),
  },
  returns: v.union(
    v.object({
      ok: v.literal(true),
      requestId: v.id("accessRequests"),
      publicToken: v.string(),
      claimHandle: v.string(),
      expiresAt: v.number(),
      status: v.literal("pending"),
      agentName: v.string(),
      apps: v.array(appValidator),
      ttlMs: v.number(),
      reason: v.optional(v.string()),
    }),
    denyResultValidator,
  ),
  handler: async (ctx, args) => {
    const agentName = args.agentName.trim();
    if (agentName.length === 0) {
      return denyCreate(400, "agentName must be non-empty", "INVALID_REQUEST");
    }
    if (agentName.length > MAX_SLICE_NAME) {
      return denyCreate(
        400,
        "agentName must be 80 characters or fewer",
        "INVALID_REQUEST",
      );
    }
    if (!Number.isFinite(args.ttlMs) || args.ttlMs <= 0) {
      return denyCreate(400, "ttlMs must be a positive number", "INVALID_REQUEST");
    }
    if (args.ttlMs > MAX_TTL_MS) {
      return denyCreate(400, "ttlMs must be 7 days or fewer", "INVALID_REQUEST");
    }
    const uniqueApps = [...new Set(args.apps)];
    if (uniqueApps.length === 0 || uniqueApps.length > MAX_SLICE_APPS) {
      return denyCreate(400, `apps must include 1 to ${MAX_SLICE_APPS} apps`, "INVALID_REQUEST");
    }
    let reason = args.reason?.trim();
    if (reason !== undefined && reason.length === 0) {
      reason = undefined;
    }
    if (reason !== undefined && reason.length > MAX_REASON_LENGTH) {
      return denyCreate(
        400,
        `reason must be ${MAX_REASON_LENGTH} characters or fewer`,
        "INVALID_REQUEST",
      );
    }

    const now = Date.now();
    const open = await ctx.db.query("accessRequests")
      .withIndex("by_kind_status_expiresAt", (q) =>
        q.eq("kind", "onboarding").eq("status", "pending").gt("expiresAt", now))
      .take(MAX_PENDING_ONBOARDING);
    if (open.length >= MAX_PENDING_ONBOARDING) {
      return denyCreate(429, "Too many pending onboarding requests", "INVALID_REQUEST");
    }
    const expiresAt = now + ONBOARDING_PENDING_TTL_MS;
    const { publicToken, claimHandle, claimSecretHash } = await issuePublicPair();
    const requestId = await ctx.db.insert("accessRequests", {
      kind: "onboarding",
      agentName,
      apps: uniqueApps,
      ttlMs: args.ttlMs,
      reason,
      publicToken,
      claimSecretHash,
      status: "pending",
      expiresAt,
    });
    return {
      ok: true as const,
      requestId,
      publicToken,
      claimHandle,
      expiresAt,
      status: "pending" as const,
      agentName,
      apps: uniqueApps,
      ttlMs: args.ttlMs,
      reason,
    };
  },
});

async function onboardingByClaim(ctx: MutationCtx | QueryCtx, claimHandle: string) {
  const claimSecretHash = await sha256Hex(claimHandle);
  const request = await ctx.db.query("accessRequests")
    .withIndex("by_claim_secret_hash", (q) => q.eq("claimSecretHash", claimSecretHash))
    .unique();
  return request?.kind === "onboarding" ? request : null;
}

function claimDenial(request: NonNullable<Awaited<ReturnType<typeof onboardingByClaim>>>) {
  const status = effectiveRequestStatus(request, Date.now());
  if (status === "denied") return denyCreate(403, APPROVAL_DENIED_ERROR, "APPROVAL_DENIED");
  if (status === "expired" || status === "claimed") {
    return denyCreate(403, APPROVAL_EXPIRED_ERROR, "APPROVAL_EXPIRED");
  }
  return null;
}

export const resolveOnboardingStatus = internalQuery({
  args: { claimHandle: v.string() },
  returns: v.union(
    v.object({
      ok: v.literal(true),
      requestId: v.id("accessRequests"),
      publicToken: v.string(),
      status: requestStatusValidator,
      expiresAt: v.number(),
      agentName: v.string(),
      apps: v.array(appValidator),
      ttlMs: v.number(),
      reason: v.optional(v.string()),
    }),
    denyResultValidator,
  ),
  handler: async (ctx, args) => {
    const request = await onboardingByClaim(ctx, args.claimHandle);
    if (!request) return denyCreate(401, "Unknown claim handle", "UNAUTHORIZED");
    const denied = claimDenial(request);
    if (denied) return denied;
    return {
      ok: true as const,
      requestId: request._id,
      publicToken: request.publicToken,
      status: request.status,
      expiresAt: request.expiresAt,
      agentName: request.agentName,
      apps: request.apps,
      ttlMs: request.ttlMs,
      reason: request.reason,
    };
  },
});

export const resolveOnboardingClaim = internalMutation({
  args: { claimHandle: v.string() },
  returns: v.union(
    v.object({
      ok: v.literal(true),
      kind: v.literal("pending"),
      requestId: v.id("accessRequests"),
      publicToken: v.string(),
      status: v.literal("pending"),
      expiresAt: v.number(),
      agentName: v.string(),
      apps: v.array(appValidator),
    }),
    v.object({
      ok: v.literal(true),
      kind: v.literal("slice"),
      requestId: v.id("accessRequests"),
      sliceId: v.id("slices"),
      sliceToken: v.string(),
      sliceSecret: v.string(),
      expiresAt: v.number(),
      name: v.string(),
      apps: v.array(appValidator),
      mintPolicy: v.literal("auto"),
    }),
    denyResultValidator,
  ),
  handler: async (ctx, args) => {
    const request = await onboardingByClaim(ctx, args.claimHandle);
    if (!request) return denyCreate(401, "Unknown claim handle", "UNAUTHORIZED");
    const denied = claimDenial(request);
    if (denied) return denied;
    const now = Date.now();
    if (request.status === "pending") {
      return {
        ok: true as const,
        kind: "pending" as const,
        requestId: request._id,
        publicToken: request.publicToken,
        status: "pending" as const,
        expiresAt: request.expiresAt,
        agentName: request.agentName,
        apps: request.apps,
      };
    }

    // approved → return slice creds once
    if (
      !request.issuedSliceToken ||
      !request.issuedSliceSecretCipher ||
      !request.sliceId
    ) {
      return denyCreate(
        500,
        "Approved request is missing issued slice credentials",
        "INVALID_REQUEST",
      );
    }
    let sliceSecret: string;
    try {
      sliceSecret = await decryptToken(request.issuedSliceSecretCipher);
    } catch {
      return denyCreate(
        503,
        "Failed to unwrap issued slice secret",
        "PROVIDER_ERROR",
      );
    }
    const slice = await ctx.db.get("slices", request.sliceId);
    if (!slice) {
      return denyCreate(404, "Slice missing for approved request", "INVALID_REQUEST");
    }
    await ctx.db.patch("accessRequests", request._id, {
      status: "claimed",
      claimedAt: now,
      // Clear one-time secret material (empty string; status gate prevents reuse).
      issuedSliceSecretCipher: "",
    });
    return {
      ok: true as const,
      kind: "slice" as const,
      requestId: request._id,
      sliceId: slice._id,
      sliceToken: request.issuedSliceToken,
      sliceSecret,
      expiresAt: slice.expiresAt,
      name: slice.name,
      apps: request.apps,
      mintPolicy: "auto" as const,
    };
  },
});
