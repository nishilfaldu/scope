import { v } from "convex/values";
import { requestStatusValidator } from "../../domain/requests";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "../../_generated/server";
import { internal } from "../../_generated/api";
import { appValidator } from "../../domain/apps";
import { APPROVAL_DENIED_ERROR, denyResultValidator } from "../../lib/errors";
import { decryptToken, encryptToken } from "../../lib/tokenEncryption";
import { hashesEqual, randomSecret, sha256Hex } from "../../lib/secrets";
import { denyCreate, MAX_TTL_MS } from "./helpers";
import { sliceHandoff, isRevocation } from "../../domain/handoff";
import {
  activeAgentConnection,
  activeConnectionForAgent,
  agentAccessRevokedAt,
  connectionBySecret,
  connectionAccessDenial,
} from "../agentConnections";

export const SLICE_REQUEST_TTL_MS = 24 * 60 * 60 * 1000;
export const SLICE_ACK_WINDOW_MS = 2 * 60 * 1000;
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
      approvalDeadlineAt: v.number(),
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
    const identified = await connectionBySecret(
      ctx,
      args.agentConnectionId,
      args.agentConnectionSecret,
    );
    if (!identified) {
      return denyCreate(401, "Invalid agent connection", "UNAUTHORIZED");
    }
    const accessDenial = await connectionAccessDenial(ctx, identified);
    if (accessDenial) return accessDenial;
    const agentConnection = identified;
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
        const slice = existing.createdSliceId
          ? await ctx.db.get("slices", existing.createdSliceId)
          : null;
        if (
          !existing.claimHandleCipher ||
          existing.status === "denied" ||
          existing.status === "claimed" ||
          sliceHandoff(existing, slice, true, Date.now()).reasonCode
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
          approvalDeadlineAt: existing.approvalDeadlineAt,
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
      .withIndex("by_userId_status_approvalDeadlineAt", (q) =>
        q
          .eq("userId", agentConnection.userId)
          .eq("status", "pending")
          .gt("approvalDeadlineAt", now),
      )
      .take(MAX_PENDING_SLICE_REQUESTS);
    if (open.length >= MAX_PENDING_SLICE_REQUESTS) {
      return denyCreate(
        429,
        "Too many pending onboarding requests",
        "INVALID_REQUEST",
      );
    }
    const approvalDeadlineAt = now + SLICE_REQUEST_TTL_MS;
    const { publicToken, claimHandle, claimSecretHash } =
      await issuePublicPair();
    const requestId = await ctx.db.insert("sliceRequests", {
      agentId: agentConnection.agentId,
      userId: agentConnection.userId,
      apps: uniqueApps,
      ttlMs: args.ttlMs,
      reason,
      publicToken,
      claimSecretHash,
      status: "pending",
      approvalDeadlineAt,
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
        internal.tables.slices.sliceRequestExpiry.clearClaimSecret,
        { requestId },
      );
    }
    return {
      ok: true as const,
      requestId,
      publicToken,
      claimHandle,
      approvalDeadlineAt,
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

export const resolveSliceRequestStatus = internalQuery({
  args: { claimHandle: v.string(), now: v.optional(v.number()) },
  returns: v.union(
    v.object({
      ok: v.literal(true),
      requestId: v.id("sliceRequests"),
      publicToken: v.string(),
      status: requestStatusValidator,
      approvalDeadlineAt: v.number(),
      pickupDeadlineAt: v.optional(v.number()),
      ackDeadlineAt: v.optional(v.number()),
      sliceExpiresAt: v.optional(v.number()),
      handoffStatus: v.string(),
      resourceStatus: v.optional(
        v.union(
          v.literal("staged"),
          v.literal("active"),
          v.literal("revoked"),
          v.literal("expired"),
        ),
      ),
      acknowledgedAt: v.optional(v.number()),
      reasonCode: v.optional(v.string()),
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
    const slice = request.createdSliceId
      ? await ctx.db.get("slices", request.createdSliceId)
      : null;
    const { resourceStatus, reasonCode, handoffStatus } = sliceHandoff(
      request,
      slice,
      !!agentConnection,
      args.now ?? Date.now(),
      agentConnection
        ? undefined
        : await agentAccessRevokedAt(ctx, request.agentId),
    );
    return {
      ok: true as const,
      requestId: request._id,
      publicToken: request.publicToken,
      status: request.status,
      approvalDeadlineAt: request.approvalDeadlineAt,
      pickupDeadlineAt: request.pickupDeadlineAt,
      ackDeadlineAt: request.ackDeadlineAt,
      sliceExpiresAt: slice?.expiresAt,
      handoffStatus,
      resourceStatus,
      acknowledgedAt: request.claimAcknowledgedAt,
      reasonCode,
      agentName: agentConnection?.name ?? "Agent",
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
      approvalDeadlineAt: v.number(),
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
      sliceExpiresAt: v.number(),
      ackDeadlineAt: v.number(),
      ackRequired: v.literal(true),
      name: v.string(),
      apps: v.array(appValidator),
      mintPolicy: v.union(v.literal("auto"), v.literal("approve")),
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
    const slice = request.createdSliceId
      ? await ctx.db.get("slices", request.createdSliceId)
      : null;
    const handoff = sliceHandoff(
      request,
      slice,
      !!agentConnection,
      Date.now(),
      agentConnection
        ? undefined
        : await agentAccessRevokedAt(ctx, request.agentId),
    );
    if (request.status === "denied" && !request.terminalReason)
      return denyCreate(403, APPROVAL_DENIED_ERROR, "APPROVAL_DENIED");
    if (handoff.reasonCode)
      return denyCreate(
        403,
        handoff.reasonCode,
        isRevocation(handoff.reasonCode) ? "REVOKED" : "APPROVAL_EXPIRED",
      );
    if (!agentConnection)
      return denyCreate(403, "Agent connection revoked", "REVOKED");
    if (request.status === "pending") {
      return {
        ok: true as const,
        kind: "pending" as const,
        requestId: request._id,
        publicToken: request.publicToken,
        status: "pending" as const,
        approvalDeadlineAt: request.approvalDeadlineAt,
        agentName: agentConnection.name,
        apps: request.apps,
      };
    }

    if (request.claimAcknowledgedAt) {
      return denyCreate(
        409,
        "Slice claim was already acknowledged",
        "CLAIM_ALREADY_ACKNOWLEDGED",
      );
    }
    // Approved claims remain retryable until the fixed acknowledgment deadline.
    if (!request.issuedSliceSecretCipher || !request.createdSliceId) {
      return denyCreate(
        403,
        "Slice claim is no longer available",
        "APPROVAL_EXPIRED",
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
    if (!slice || slice.status !== "staged") {
      return denyCreate(403, "Slice is no longer available", "EXPIRED");
    }
    const now = Date.now();
    const ackDeadlineAt = request.ackDeadlineAt ?? now + SLICE_ACK_WINDOW_MS;
    if (!request.firstClaimedAt) {
      await ctx.db.patch("sliceRequests", request._id, {
        status: "claimed",
        firstClaimedAt: now,
        ackDeadlineAt,
      });
      await ctx.scheduler.runAt(
        ackDeadlineAt,
        internal.tables.slices.sliceRequestExpiry.clearClaimSecret,
        { requestId: request._id },
      );
    }
    return {
      ok: true as const,
      kind: "slice" as const,
      requestId: request._id,
      sliceId: slice._id,
      sliceToken: slice.token,
      sliceSecret,
      sliceExpiresAt: slice.expiresAt,
      ackDeadlineAt,
      ackRequired: true as const,
      name: slice.name,
      apps: request.apps,
      mintPolicy: slice.mintPolicy,
    };
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
      request.status !== "pending" ||
      request.terminalReason ||
      request.approvalDeadlineAt <= Date.now()
    ) {
      return false;
    }
    await ctx.db.patch("sliceRequests", request._id, {
      status: "denied",
      terminalReason: "agent_cancelled",
      claimHandleCipher: "",
    });
    return true;
  },
});

export const acknowledgeSliceClaim = internalMutation({
  args: { claimHandle: v.string(), sliceSecret: v.string() },
  returns: v.union(
    v.object({
      ok: v.literal(true),
      acknowledgedAt: v.number(),
      resourceStatus: v.union(
        v.literal("active"),
        v.literal("revoked"),
        v.literal("expired"),
      ),
    }),
    denyResultValidator,
  ),
  handler: async (ctx, args) => {
    const request = await sliceRequestByClaim(ctx, args.claimHandle);
    if (!request)
      return denyCreate(401, "Unknown claim handle", "UNAUTHORIZED");
    if (!request.createdSliceId)
      return denyCreate(403, "Slice claim unavailable", "EXPIRED");
    const slice = await ctx.db.get("slices", request.createdSliceId);
    if (
      !slice ||
      !hashesEqual(slice.secretHash, await sha256Hex(args.sliceSecret))
    )
      return denyCreate(401, "Invalid slice credentials", "UNAUTHORIZED");
    const parent = await activeConnectionForAgent(ctx, slice.agentId);
    const handoff = sliceHandoff(
      request,
      slice,
      !!parent,
      Date.now(),
      parent ? undefined : await agentAccessRevokedAt(ctx, request.agentId),
    );
    const resourceStatus = handoff.resourceStatus;
    if (request.claimAcknowledgedAt)
      return {
        ok: true as const,
        acknowledgedAt: request.claimAcknowledgedAt,
        resourceStatus:
          resourceStatus === "active"
            ? ("active" as const)
            : resourceStatus === "expired"
              ? ("expired" as const)
              : ("revoked" as const),
      };
    if (handoff.reasonCode)
      return denyCreate(
        403,
        handoff.reasonCode,
        isRevocation(handoff.reasonCode) ? "REVOKED" : "EXPIRED",
      );
    if (
      handoff.handoffStatus !== "waiting_for_ack" ||
      slice.status !== "staged"
    )
      return denyCreate(403, "Slice claim unavailable", "EXPIRED");
    const now = Date.now();
    await ctx.db.patch("slices", slice._id, { status: "active" });
    await ctx.db.patch("sliceRequests", request._id, {
      claimAcknowledgedAt: now,
      issuedSliceSecretCipher: "",
      claimHandleCipher: "",
    });
    return {
      ok: true as const,
      acknowledgedAt: now,
      resourceStatus: "active" as const,
    };
  },
});
