import { v } from "convex/values";
import {
  requestStatusValidator,
  effectiveRequestStatus,
} from "../../domain/requests";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "../../_generated/server";
import { internal } from "../../_generated/api";
import { appValidator } from "../../domain/apps";
import {
  APPROVAL_DENIED_ERROR,
  APPROVAL_EXPIRED_ERROR,
  denyResultValidator,
} from "../../lib/errors";
import { decryptToken, encryptToken } from "../../lib/tokenEncryption";
import { randomSecret, sha256Hex } from "../../lib/secrets";
import { denyCreate, MAX_TTL_MS } from "./helpers";
import {
  activeAgentConnection,
  activeConnectionForAgent,
} from "../agentConnections";

export const SLICE_REQUEST_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_PENDING_SLICE_REQUESTS = 100;
export const MAX_REASON_LENGTH = 280;

export async function issuePublicPair() {
  const publicToken = randomSecret("ar_");
  const claimHandle = randomSecret("ch_");
  const claimSecretHash = await sha256Hex(claimHandle);
  return { publicToken, claimHandle, claimSecretHash };
}

export const createSliceRequest = internalMutation({
  args: {
    agentConnectionId: v.string(),
    agentConnectionSecret: v.string(),
    apps: v.array(appValidator),
    ttlMs: v.number(),
    reason: v.string(),
    idempotencyKey: v.optional(v.string()),
  },
  returns: v.union(
    v.object({
      ok: v.literal(true),
      requestId: v.id("sliceRequests"),
      publicToken: v.string(),
      claimHandle: v.string(),
      expiresAt: v.number(),
      status: v.union(v.literal("pending"), v.literal("approved")),
      agentName: v.string(),
      apps: v.array(appValidator),
      ttlMs: v.number(),
      reason: v.string(),
      reused: v.boolean(),
    }),
    denyResultValidator,
  ),
  handler: async (ctx, args) => {
    const agentConnection = await activeAgentConnection(
      ctx,
      args.agentConnectionId,
      args.agentConnectionSecret,
    );
    if (!agentConnection) {
      return denyCreate(
        401,
        "Invalid or revoked agent connection",
        "UNAUTHORIZED",
      );
    }
    const agentName = agentConnection.name;
    if (!Number.isFinite(args.ttlMs) || args.ttlMs <= 0) {
      return denyCreate(
        400,
        "ttlMs must be a positive number",
        "INVALID_REQUEST",
      );
    }
    if (args.ttlMs > MAX_TTL_MS) {
      return denyCreate(
        400,
        "ttlMs must be 7 days or fewer",
        "INVALID_REQUEST",
      );
    }
    const uniqueApps = [...new Set(args.apps)];
    if (uniqueApps.length === 0) {
      return denyCreate(
        400,
        "apps must include at least one app",
        "INVALID_REQUEST",
      );
    }
    const reason = args.reason.trim();
    if (reason.length === 0) {
      return denyCreate(400, "reason must be non-empty", "INVALID_REQUEST");
    }
    if (reason.length > MAX_REASON_LENGTH) {
      return denyCreate(
        400,
        `reason must be ${MAX_REASON_LENGTH} characters or fewer`,
        "INVALID_REQUEST",
      );
    }

    const idempotencyKeyHash = args.idempotencyKey
      ? await sha256Hex(`${agentConnection.agentId}:${args.idempotencyKey}`)
      : undefined;
    if (idempotencyKeyHash) {
      const existing = await ctx.db
        .query("sliceRequests")
        .withIndex("by_idempotency_key_hash", (q) =>
          q.eq("idempotencyKeyHash", idempotencyKeyHash),
        )
        .unique();
      if (existing) {
        if (
          existing.agentId !== agentConnection.agentId ||
          existing.ttlMs !== args.ttlMs ||
          existing.reason !== reason ||
          JSON.stringify(existing.apps) !== JSON.stringify(uniqueApps)
        ) {
          return denyCreate(
            409,
            "Idempotency-Key was used for a different request",
            "IDEMPOTENCY_CONFLICT",
          );
        }
        if (
          !existing.claimHandleCipher ||
          existing.expiresAt <= Date.now() ||
          existing.status === "denied" ||
          existing.status === "claimed"
        ) {
          return denyCreate(
            409,
            "This request can no longer be retried; use a new Idempotency-Key",
            "IDEMPOTENCY_CONFLICT",
          );
        }
        return {
          ok: true as const,
          requestId: existing._id,
          publicToken: existing.publicToken,
          claimHandle: await decryptToken(existing.claimHandleCipher),
          expiresAt: existing.expiresAt,
          status: existing.status,
          agentName,
          apps: uniqueApps,
          ttlMs: args.ttlMs,
          reason,
          reused: true,
        };
      }
    }

    const now = Date.now();
    const open = await ctx.db
      .query("sliceRequests")
      .withIndex("by_status_expiresAt", (q) =>
        q.eq("status", "pending").gt("expiresAt", now),
      )
      .take(MAX_PENDING_SLICE_REQUESTS);
    if (open.length >= MAX_PENDING_SLICE_REQUESTS) {
      return denyCreate(
        429,
        "Too many pending onboarding requests",
        "INVALID_REQUEST",
      );
    }
    const expiresAt = now + SLICE_REQUEST_TTL_MS;
    const { publicToken, claimHandle, claimSecretHash } =
      await issuePublicPair();
    const requestId = await ctx.db.insert("sliceRequests", {
      agentId: agentConnection.agentId,
      apps: uniqueApps,
      ttlMs: args.ttlMs,
      reason,
      publicToken,
      claimSecretHash,
      status: "pending",
      expiresAt,
      idempotencyKeyHash,
      claimHandleCipher: idempotencyKeyHash
        ? await encryptToken(claimHandle)
        : undefined,
    });
    await ctx.db.patch("agentConnections", agentConnection._id, {
      lastUsedAt: now,
    });
    if (idempotencyKeyHash) {
      await ctx.scheduler.runAfter(
        SLICE_REQUEST_TTL_MS,
        internal.tables.slices.sliceRequestClaims.clearClaimSecret,
        { requestId },
      );
    }
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
      reused: false,
    };
  },
});

async function sliceRequestByClaim(
  ctx: MutationCtx | QueryCtx,
  claimHandle: string,
) {
  const claimSecretHash = await sha256Hex(claimHandle);
  const request = await ctx.db
    .query("sliceRequests")
    .withIndex("by_claim_secret_hash", (q) =>
      q.eq("claimSecretHash", claimSecretHash),
    )
    .unique();
  return request;
}

function claimDenial(
  request: NonNullable<Awaited<ReturnType<typeof sliceRequestByClaim>>>,
) {
  const status = effectiveRequestStatus(request, Date.now());
  if (status === "denied")
    return denyCreate(403, APPROVAL_DENIED_ERROR, "APPROVAL_DENIED");
  if (status === "expired" || status === "claimed") {
    return denyCreate(403, APPROVAL_EXPIRED_ERROR, "APPROVAL_EXPIRED");
  }
  return null;
}

export const resolveSliceRequestStatus = internalQuery({
  args: { claimHandle: v.string() },
  returns: v.union(
    v.object({
      ok: v.literal(true),
      requestId: v.id("sliceRequests"),
      publicToken: v.string(),
      status: requestStatusValidator,
      expiresAt: v.number(),
      agentName: v.string(),
      apps: v.array(appValidator),
      ttlMs: v.number(),
      reason: v.string(),
    }),
    denyResultValidator,
  ),
  handler: async (ctx, args) => {
    const request = await sliceRequestByClaim(ctx, args.claimHandle);
    if (!request)
      return denyCreate(401, "Unknown claim handle", "UNAUTHORIZED");
    const agentConnection = await activeConnectionForAgent(
      ctx,
      request.agentId,
    );
    if (!agentConnection) {
      return denyCreate(403, "Agent connection has been revoked", "REVOKED");
    }
    const denied = claimDenial(request);
    if (denied) return denied;
    return {
      ok: true as const,
      requestId: request._id,
      publicToken: request.publicToken,
      status: request.status,
      expiresAt: request.expiresAt,
      agentName: agentConnection.name,
      apps: request.apps,
      ttlMs: request.ttlMs,
      reason: request.reason,
    };
  },
});

export const resolveSliceRequestClaim = internalMutation({
  args: { claimHandle: v.string() },
  returns: v.union(
    v.object({
      ok: v.literal(true),
      kind: v.literal("pending"),
      requestId: v.id("sliceRequests"),
      publicToken: v.string(),
      status: v.literal("pending"),
      expiresAt: v.number(),
      agentName: v.string(),
      apps: v.array(appValidator),
    }),
    v.object({
      ok: v.literal(true),
      kind: v.literal("slice"),
      requestId: v.id("sliceRequests"),
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
    const request = await sliceRequestByClaim(ctx, args.claimHandle);
    if (!request)
      return denyCreate(401, "Unknown claim handle", "UNAUTHORIZED");
    const agentConnection = await activeConnectionForAgent(
      ctx,
      request.agentId,
    );
    if (!agentConnection) {
      return denyCreate(403, "Agent connection has been revoked", "REVOKED");
    }
    const denied = claimDenial(request);
    if (denied) return denied;
    if (request.status === "pending") {
      return {
        ok: true as const,
        kind: "pending" as const,
        requestId: request._id,
        publicToken: request.publicToken,
        status: "pending" as const,
        expiresAt: request.expiresAt,
        agentName: agentConnection.name,
        apps: request.apps,
      };
    }

    // approved → return slice creds once
    if (!request.issuedSliceSecretCipher || !request.createdSliceId) {
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
    const slice = await ctx.db.get("slices", request.createdSliceId);
    if (!slice) {
      return denyCreate(
        404,
        "Slice missing for approved request",
        "INVALID_REQUEST",
      );
    }
    await ctx.db.patch("sliceRequests", request._id, {
      status: "claimed",
      issuedSliceSecretCipher: "",
      claimHandleCipher: "",
    });
    return {
      ok: true as const,
      kind: "slice" as const,
      requestId: request._id,
      sliceId: slice._id,
      sliceToken: slice.token,
      sliceSecret,
      expiresAt: slice.expiresAt,
      name: slice.name,
      apps: request.apps,
      mintPolicy: "auto" as const,
    };
  },
});

export const clearClaimSecret = internalMutation({
  args: { requestId: v.id("sliceRequests") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const request = await ctx.db.get("sliceRequests", args.requestId);
    if (request && request.expiresAt <= Date.now()) {
      await ctx.db.patch("sliceRequests", request._id, {
        issuedSliceSecretCipher: "",
        claimHandleCipher: "",
      });
    }
    return null;
  },
});

export const cancelSliceRequest = internalMutation({
  args: {
    agentConnectionId: v.string(),
    agentConnectionSecret: v.string(),
    claimHandle: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const agentConnection = await activeAgentConnection(
      ctx,
      args.agentConnectionId,
      args.agentConnectionSecret,
    );
    if (!agentConnection) return false;
    const request = await sliceRequestByClaim(ctx, args.claimHandle);
    if (
      !request ||
      request.agentId !== agentConnection.agentId ||
      request.status !== "pending"
    ) {
      return false;
    }
    await ctx.db.patch("sliceRequests", request._id, {
      expiresAt: Date.now(),
      claimHandleCipher: "",
    });
    return true;
  },
});
