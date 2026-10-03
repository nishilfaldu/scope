import { ConvexError, v } from "convex/values";
import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import type { Doc } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import { authenticatedMutation, authenticatedQuery } from "../functions";
import { decryptToken, encryptToken } from "../lib/tokenEncryption";
import { hashesEqual, randomSecret, sha256Hex } from "../lib/secrets";
import {
  agentErrorCodeValidator,
  denyResultValidator,
  type AgentErrorCode,
} from "../lib/errors";
import {
  connectionHandoff,
  connectionDeadline,
  isRevocation,
} from "../domain/handoff";

const INVITE_TTL_MS = 15 * 60 * 1000;
const PICKUP_TTL_MS = 5 * 60 * 1000;
const COMPLETION_TTL_MS = 2 * 60 * 1000;

function denyCreate(
  status: number,
  reason: string,
  code: AgentErrorCode,
  completion?: { completionPath: string; completionDeadlineAt: number },
) {
  return { ok: false as const, status, reason, code, ...completion };
}

function claimError(status: number, reason: string, code: AgentErrorCode) {
  return { kind: "error" as const, status, reason, code };
}

async function lineage(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  agentId: string,
) {
  return await ctx.db
    .query("agentLineages")
    .withIndex("by_agentId", (q) => q.eq("agentId", agentId))
    .unique();
}

export async function activeAgentConnection(
  ctx: QueryCtx | MutationCtx,
  connectionId: string,
  secret: string,
) {
  const id = ctx.db.normalizeId("agentConnections", connectionId);
  const connection = id ? await ctx.db.get("agentConnections", id) : null;
  if (
    !connection ||
    connection.status !== "active" ||
    (await lineage(ctx, connection.agentId))?.revokedAt !== undefined
  )
    return null;
  return hashesEqual(connection.secretHash, await sha256Hex(secret))
    ? connection
    : null;
}

export async function connectionBySecret(
  ctx: QueryCtx | MutationCtx,
  connectionId: string,
  secret: string,
) {
  const id = ctx.db.normalizeId("agentConnections", connectionId);
  const connection = id ? await ctx.db.get("agentConnections", id) : null;
  return connection &&
    hashesEqual(connection.secretHash, await sha256Hex(secret))
    ? connection
    : null;
}

export async function activeConnectionForAgent(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  agentId: string,
) {
  if ((await lineage(ctx, agentId))?.revokedAt !== undefined) return null;
  return await ctx.db
    .query("agentConnections")
    .withIndex("by_agentId_status", (q) =>
      q.eq("agentId", agentId).eq("status", "active"),
    )
    .unique();
}

export async function agentAccessRevokedAt(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  agentId: string,
): Promise<number | undefined> {
  const currentLineage = await lineage(ctx, agentId);
  const active = await ctx.db
    .query("agentConnections")
    .withIndex("by_agentId_status", (q) =>
      q.eq("agentId", agentId).eq("status", "active"),
    )
    .unique();
  if (active) return currentLineage?.revokedAt;

  for await (const row of ctx.db
    .query("agentConnections")
    .withIndex("by_agentId_status", (q) =>
      q.eq("agentId", agentId).eq("status", "revoked"),
    )
    .order("desc")) {
    const invite = await ctx.db
      .query("agentConnectionInvites")
      .withIndex("by_agent_connection_id", (q) =>
        q.eq("agentConnectionId", row._id),
      )
      .unique();
    if (
      !invite ||
      invite.claimAcknowledgedAt !== undefined ||
      invite.activatedAt !== undefined
    )
      return row.revokedAt === undefined
        ? currentLineage?.revokedAt
        : Math.min(row.revokedAt, currentLineage?.revokedAt ?? Infinity);
  }
  return currentLineage?.revokedAt;
}

export async function projectConnectionHandoff(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  invite: Doc<"agentConnectionInvites">,
  connection: Doc<"agentConnections"> | null,
  now: number,
) {
  const currentLineage = await lineage(ctx, invite.agentId);
  const predecessor = invite.replacesAgentConnectionId
    ? await ctx.db.get("agentConnections", invite.replacesAgentConnectionId)
    : null;
  return connectionHandoff(
    invite,
    connection,
    currentLineage?.revokedAt,
    now,
    predecessor,
  );
}

function connectionTerminalDenial(
  handoff: Awaited<ReturnType<typeof projectConnectionHandoff>>,
) {
  if (!handoff.reason) return null;
  return denyCreate(
    403,
    isRevocation(handoff.reason)
      ? "Agent connection revoked"
      : "Connection claim expired",
    isRevocation(handoff.reason) ? "REVOKED" : "EXPIRED",
  );
}

export async function connectionAccessDenial(
  ctx: QueryCtx | MutationCtx,
  connection: Doc<"agentConnections">,
) {
  const invite = await ctx.db
    .query("agentConnectionInvites")
    .withIndex("by_agent_connection_id", (q) =>
      q.eq("agentConnectionId", connection._id),
    )
    .unique();
  if (invite) {
    const handoff = await projectConnectionHandoff(
      ctx,
      invite,
      connection,
      Date.now(),
    );
    const terminal = connectionTerminalDenial(handoff);
    if (terminal) return terminal;
    if (
      handoff.handoffStatus === "waiting_for_ack" ||
      handoff.handoffStatus === "waiting_for_activation"
    ) {
      const replacement = !!invite.replacesAgentConnectionId;
      return denyCreate(
        409,
        replacement
          ? "Activate the replacement connection"
          : "Acknowledge the connection claim",
        replacement ? "ACTIVATION_REQUIRED" : "CLAIM_ACK_REQUIRED",
        {
          completionPath: replacement
            ? "/api/agent-connections/activate"
            : "/api/agent-connections/ack",
          completionDeadlineAt: connectionDeadline(invite)!.at,
        },
      );
    }
  }
  if (
    connection.status === "revoked" ||
    (await lineage(ctx, connection.agentId))?.revokedAt !== undefined
  )
    return denyCreate(403, "Agent connection revoked", "REVOKED");
  if (connection.status !== "active")
    return denyCreate(403, "Connection claim unavailable", "EXPIRED");
  return null;
}

export const createInvite = internalMutation({
  args: {
    agentName: v.string(),
    previousConnectionId: v.optional(v.string()),
    previousConnectionSecret: v.optional(v.string()),
  },
  returns: v.object({
    publicToken: v.string(),
    claimHandle: v.string(),
    approvalDeadlineAt: v.number(),
    agentName: v.string(),
    agentId: v.string(),
    reconnecting: v.boolean(),
  }),
  handler: async (ctx, args) => {
    if (
      (args.previousConnectionId === undefined) !==
      (args.previousConnectionSecret === undefined)
    ) {
      throw new Error(
        "Previous connection ID and secret must be provided together",
      );
    }
    const identified =
      args.previousConnectionId && args.previousConnectionSecret
        ? await connectionBySecret(
            ctx,
            args.previousConnectionId,
            args.previousConnectionSecret,
          )
        : null;
    if (args.previousConnectionId && !identified)
      throw new ConvexError(
        denyCreate(401, "Invalid previous agent connection", "UNAUTHORIZED"),
      );
    if (identified) {
      const denial = await connectionAccessDenial(ctx, identified);
      if (denial) throw new ConvexError(denial);
    }
    const previous = identified;
    const agentName = previous?.name ?? args.agentName.trim();
    if (!agentName || agentName.length > 80)
      throw new Error("agentName must be 1 to 80 characters");
    const publicToken = randomSecret("ac_");
    const claimHandle = randomSecret("ach_");
    const approvalDeadlineAt = Date.now() + INVITE_TTL_MS;
    const agentId = previous?.agentId ?? randomSecret("ag_");
    await ctx.db.insert("agentConnectionInvites", {
      publicToken,
      claimSecretHash: await sha256Hex(claimHandle),
      agentId,
      agentName,
      status: "pending",
      approvalDeadlineAt,
      userId: previous?.userId,
      replacesAgentConnectionId: previous?._id,
    });
    await ctx.scheduler.runAfter(
      INVITE_TTL_MS,
      internal.tables.agentConnectionExpiry.expireInvite,
      { publicToken },
    );
    return {
      publicToken,
      claimHandle,
      approvalDeadlineAt,
      agentName,
      agentId,
      reconnecting: previous !== null,
    };
  },
});

const inviteView = v.object({
  agentId: v.string(),
  agentName: v.string(),
  reconnecting: v.boolean(),
  status: v.union(
    v.literal("pending"),
    v.literal("approved"),
    v.literal("denied"),
    v.literal("claimed"),
    v.literal("expired"),
  ),
  approvalDeadlineAt: v.number(),
  pickupDeadlineAt: v.optional(v.number()),
  ackDeadlineAt: v.optional(v.number()),
  activationDeadlineAt: v.optional(v.number()),
  handoffStatus: v.string(),
  replacementOptions: v.array(
    v.object({ id: v.id("agentConnections"), name: v.string() }),
  ),
  resourceStatus: v.optional(
    v.union(v.literal("staged"), v.literal("active"), v.literal("revoked")),
  ),
  reason: v.optional(v.string()),
});

export const getInvite = authenticatedQuery({
  args: { publicToken: v.string(), now: v.optional(v.number()) },
  returns: v.union(inviteView, v.null()),
  handler: async (ctx, args) => {
    const invite = await ctx.db
      .query("agentConnectionInvites")
      .withIndex("by_public_token", (q) =>
        q.eq("publicToken", args.publicToken),
      )
      .unique();
    if (!invite || (invite.userId && invite.userId !== ctx.userId)) return null;
    const connection = invite.agentConnectionId
      ? await ctx.db.get("agentConnections", invite.agentConnectionId)
      : null;
    const handoff = await projectConnectionHandoff(
      ctx,
      invite,
      connection,
      args.now ?? Date.now(),
    );
    const replacementOptions = invite.replacesAgentConnectionId
      ? []
      : (
          await ctx.db
            .query("agentConnections")
            .withIndex("by_user_status", (q) =>
              q.eq("userId", ctx.userId).eq("status", "active"),
            )
            .order("desc")
            .take(100)
        )
          .filter((connection) => connection.status === "active")
          .map((connection) => ({ id: connection._id, name: connection.name }));
    return {
      agentId: invite.agentId,
      agentName: invite.agentName,
      reconnecting: invite.replacesAgentConnectionId !== undefined,
      status: invite.status,
      approvalDeadlineAt: invite.approvalDeadlineAt,
      pickupDeadlineAt: invite.pickupDeadlineAt,
      ackDeadlineAt: invite.ackDeadlineAt,
      activationDeadlineAt: invite.activationDeadlineAt,
      handoffStatus: handoff.handoffStatus,
      resourceStatus: handoff.resourceStatus,
      reason: handoff.reason,
      replacementOptions,
    };
  },
});

export const decideInvite = authenticatedMutation({
  args: {
    publicToken: v.string(),
    decision: v.union(v.literal("approved"), v.literal("denied")),
    replaceAgentConnectionId: v.optional(v.id("agentConnections")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const invite = await ctx.db
      .query("agentConnectionInvites")
      .withIndex("by_public_token", (q) =>
        q.eq("publicToken", args.publicToken),
      )
      .unique();
    if (
      !invite ||
      invite.status !== "pending" ||
      invite.approvalDeadlineAt <= Date.now()
    ) {
      throw new Error("Connection link is no longer available");
    }
    if (invite.userId && invite.userId !== ctx.userId) {
      throw new Error("This reconnect link belongs to another Scope account");
    }
    if ((await projectConnectionHandoff(ctx, invite, null, Date.now())).reason)
      throw new Error("Connection link is no longer available");
    if (args.decision === "denied") {
      await ctx.db.patch("agentConnectionInvites", invite._id, {
        status: "denied",
        userId: ctx.userId,
      });
      return null;
    }
    const replacementId =
      invite.replacesAgentConnectionId ?? args.replaceAgentConnectionId;
    const replacement = replacementId
      ? await ctx.db.get("agentConnections", replacementId)
      : null;
    if (
      replacementId &&
      (!replacement ||
        replacement.userId !== ctx.userId ||
        replacement.status !== "active")
    ) {
      throw new Error("The connection being replaced is no longer active");
    }
    if (
      invite.replacesAgentConnectionId &&
      replacementId !== invite.replacesAgentConnectionId
    ) {
      throw new Error("Rotation target cannot be changed");
    }
    const agentId = replacement?.agentId ?? invite.agentId;
    const agentName = replacement?.name ?? invite.agentName;
    const existingLineage = await lineage(ctx, agentId);
    if (
      existingLineage?.revokedAt !== undefined ||
      (existingLineage && existingLineage.userId !== ctx.userId)
    ) {
      throw new Error("Agent lineage is revoked or belongs to another account");
    }
    if (!existingLineage) {
      await ctx.db.insert("agentLineages", { agentId, userId: ctx.userId });
    }
    const activeConnections = await ctx.db
      .query("agentConnections")
      .withIndex("by_agentId_status", (q) =>
        q.eq("agentId", agentId).eq("status", "active"),
      )
      .take(2);
    if (
      activeConnections.length > 1 ||
      activeConnections.some((connection) => connection.userId !== ctx.userId)
    ) {
      throw new Error("Agent has more than one active connection");
    }
    const secret = randomSecret("acs_");
    const agentConnectionId = await ctx.db.insert("agentConnections", {
      userId: ctx.userId,
      agentId,
      name: agentName,
      secretHash: await sha256Hex(secret),
      status: "staged",
    });
    const pickupDeadlineAt = Date.now() + PICKUP_TTL_MS;
    await ctx.db.patch("agentConnectionInvites", invite._id, {
      status: "approved",
      userId: ctx.userId,
      agentConnectionId,
      replacesAgentConnectionId: replacement?._id,
      agentId,
      agentName,
      issuedSecretCipher: await encryptToken(secret),
      pickupDeadlineAt,
    });
    await ctx.scheduler.runAt(
      pickupDeadlineAt,
      internal.tables.agentConnectionExpiry.expireInvite,
      { publicToken: invite.publicToken },
    );
    return null;
  },
});

async function inviteByClaim(ctx: QueryCtx | MutationCtx, claimHandle: string) {
  const hash = await sha256Hex(claimHandle);
  return await ctx.db
    .query("agentConnectionInvites")
    .withIndex("by_claim_secret_hash", (q) => q.eq("claimSecretHash", hash))
    .unique();
}

export const claimStatus = internalQuery({
  args: { claimHandle: v.string(), now: v.optional(v.number()) },
  returns: v.union(
    v.object({
      status: v.union(
        v.literal("pending"),
        v.literal("approved"),
        v.literal("denied"),
        v.literal("claimed"),
        v.literal("expired"),
      ),
      handoffStatus: v.string(),
      approvalDeadlineAt: v.number(),
      pickupDeadlineAt: v.optional(v.number()),
      ackDeadlineAt: v.optional(v.number()),
      activationDeadlineAt: v.optional(v.number()),
      acknowledgedAt: v.optional(v.number()),
      activatedAt: v.optional(v.number()),
      resourceStatus: v.optional(
        v.union(v.literal("staged"), v.literal("active"), v.literal("revoked")),
      ),
      reason: v.optional(v.string()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const invite = await inviteByClaim(ctx, args.claimHandle);
    if (!invite) return null;
    const connection = invite.agentConnectionId
      ? await ctx.db.get("agentConnections", invite.agentConnectionId)
      : null;
    const handoff = await projectConnectionHandoff(
      ctx,
      invite,
      connection,
      args.now ?? Date.now(),
    );
    return {
      status: invite.status,
      handoffStatus: handoff.handoffStatus,
      approvalDeadlineAt: invite.approvalDeadlineAt,
      pickupDeadlineAt: invite.pickupDeadlineAt,
      ackDeadlineAt: invite.ackDeadlineAt,
      activationDeadlineAt: invite.activationDeadlineAt,
      acknowledgedAt: invite.claimAcknowledgedAt,
      activatedAt: invite.activatedAt,
      resourceStatus: handoff.resourceStatus,
      reason: handoff.reason,
    };
  },
});

export const claim = internalMutation({
  args: { claimHandle: v.string() },
  returns: v.union(
    v.object({
      kind: v.literal("error"),
      status: v.number(),
      reason: v.string(),
      code: agentErrorCodeValidator,
    }),
    v.object({ kind: v.literal("pending"), approvalDeadlineAt: v.number() }),
    v.object({
      kind: v.literal("connected"),
      agentId: v.string(),
      agentConnectionId: v.id("agentConnections"),
      agentConnectionSecret: v.string(),
      agentName: v.string(),
      activationRequired: v.boolean(),
      ackRequired: v.boolean(),
      ackDeadlineAt: v.optional(v.number()),
      activationDeadlineAt: v.optional(v.number()),
    }),
  ),
  handler: async (ctx, args) => {
    const invite = await inviteByClaim(ctx, args.claimHandle);
    if (!invite) return claimError(401, "Unknown claim handle", "UNAUTHORIZED");
    const now = Date.now();
    if (invite.claimAcknowledgedAt || invite.activatedAt)
      return claimError(
        409,
        "Connection claim already completed",
        "CLAIM_ALREADY_ACKNOWLEDGED",
      );
    const connection = invite.agentConnectionId
      ? await ctx.db.get("agentConnections", invite.agentConnectionId)
      : null;
    const handoff = await projectConnectionHandoff(
      ctx,
      invite,
      connection,
      now,
    );
    if (invite.status === "denied")
      return claimError(403, "Connection request denied", "APPROVAL_DENIED");
    if (handoff.reason)
      return claimError(
        403,
        handoff.reason,
        isRevocation(handoff.reason) ? "REVOKED" : "APPROVAL_EXPIRED",
      );
    if (invite.status === "pending")
      return {
        kind: "pending" as const,
        approvalDeadlineAt: invite.approvalDeadlineAt,
      };
    if (
      !connection ||
      connection.status !== "staged" ||
      !invite.issuedSecretCipher
    )
      return claimError(
        403,
        "Connection invite is unavailable",
        "APPROVAL_EXPIRED",
      );
    const agentConnectionSecret = await decryptToken(invite.issuedSecretCipher);
    const activationRequired = invite.replacesAgentConnectionId !== undefined;
    const completionDeadlineAt =
      (activationRequired
        ? invite.activationDeadlineAt
        : invite.ackDeadlineAt) ?? now + COMPLETION_TTL_MS;
    if (!invite.firstClaimedAt) {
      await ctx.db.patch("agentConnectionInvites", invite._id, {
        status: "claimed",
        firstClaimedAt: now,
        ackDeadlineAt: activationRequired ? undefined : completionDeadlineAt,
        activationDeadlineAt: activationRequired
          ? completionDeadlineAt
          : undefined,
      });
      await ctx.scheduler.runAt(
        completionDeadlineAt,
        internal.tables.agentConnectionExpiry.expireInvite,
        { publicToken: invite.publicToken },
      );
    }
    return {
      kind: "connected" as const,
      agentConnectionId: connection._id,
      agentId: invite.agentId,
      agentConnectionSecret,
      agentName: invite.agentName,
      activationRequired,
      ackRequired: !activationRequired,
      ackDeadlineAt: activationRequired ? undefined : completionDeadlineAt,
      activationDeadlineAt: activationRequired
        ? completionDeadlineAt
        : undefined,
    };
  },
});

export const activateReplacement = internalMutation({
  args: { agentConnectionId: v.string(), agentConnectionSecret: v.string() },
  returns: v.union(
    v.object({
      ok: v.literal(true),
      status: v.union(v.literal("active"), v.literal("revoked")),
      activatedAt: v.number(),
    }),
    denyResultValidator,
  ),
  handler: async (ctx, args) => {
    const replacement = await connectionBySecret(
      ctx,
      args.agentConnectionId,
      args.agentConnectionSecret,
    );
    if (!replacement)
      return denyCreate(401, "Invalid connection credentials", "UNAUTHORIZED");
    const invite = await ctx.db
      .query("agentConnectionInvites")
      .withIndex("by_agent_connection_id", (q) =>
        q.eq("agentConnectionId", replacement._id),
      )
      .unique();
    if (!invite) return denyCreate(401, "Unknown connection", "UNAUTHORIZED");
    if (invite.activatedAt) {
      const active =
        replacement.status === "active" &&
        (await lineage(ctx, replacement.agentId))?.revokedAt === undefined;
      return {
        ok: true as const,
        status: active ? ("active" as const) : ("revoked" as const),
        activatedAt: invite.activatedAt,
      };
    }
    const handoff = await projectConnectionHandoff(
      ctx,
      invite,
      replacement,
      Date.now(),
    );
    const terminal = connectionTerminalDenial(handoff);
    if (terminal) return terminal;
    if (!invite.replacesAgentConnectionId)
      return denyCreate(
        409,
        "Acknowledge this new connection",
        "CLAIM_ACK_REQUIRED",
        invite.ackDeadlineAt
          ? {
              completionPath: "/api/agent-connections/ack",
              completionDeadlineAt: invite.ackDeadlineAt,
            }
          : undefined,
      );
    if (
      handoff.handoffStatus !== "waiting_for_activation" ||
      replacement.status !== "staged"
    )
      return denyCreate(403, "Activation unavailable", "EXPIRED");
    const previous = await ctx.db.get(
      "agentConnections",
      invite.replacesAgentConnectionId!,
    );
    if (!previous || previous.status !== "active")
      return denyCreate(403, "Previous connection revoked", "REVOKED");
    const now = Date.now();
    await ctx.db.patch("agentConnections", previous._id, {
      status: "revoked",
      revokedAt: now,
    });
    await ctx.db.patch("agentConnections", replacement._id, {
      status: "active",
    });
    await ctx.db.patch("agentConnectionInvites", invite._id, {
      activatedAt: now,
      issuedSecretCipher: "",
    });
    return { ok: true as const, status: "active" as const, activatedAt: now };
  },
});

export const revoke = authenticatedMutation({
  args: { agentConnectionId: v.id("agentConnections") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const connection = await ctx.db.get(
      "agentConnections",
      args.agentConnectionId,
    );
    if (!connection || connection.userId !== ctx.userId)
      throw new Error("Agent connection not found");
    const now = Date.now();
    const existingLineage = await lineage(ctx, connection.agentId);
    if (existingLineage && existingLineage.userId !== ctx.userId) {
      throw new Error("Agent connection not found");
    }
    if (existingLineage) {
      if (existingLineage.revokedAt === undefined) {
        await ctx.db.patch("agentLineages", existingLineage._id, {
          revokedAt: now,
        });
      }
    } else {
      await ctx.db.insert("agentLineages", {
        agentId: connection.agentId,
        userId: ctx.userId,
        revokedAt: now,
      });
    }
    const active = await ctx.db
      .query("agentConnections")
      .withIndex("by_agentId_status", (q) =>
        q.eq("agentId", connection.agentId).eq("status", "active"),
      )
      .unique();
    if (active) {
      await ctx.db.patch("agentConnections", active._id, {
        status: "revoked",
        revokedAt: now,
        revocationReason: "operator_revoked",
      });
    }
    const staged = await ctx.db
      .query("agentConnections")
      .withIndex("by_agentId_status", (q) =>
        q.eq("agentId", connection.agentId).eq("status", "staged"),
      )
      .collect();
    for (const row of staged) {
      await ctx.db.patch("agentConnections", row._id, {
        status: "revoked",
        revokedAt: now,
        revocationReason: "operator_revoked",
      });
    }
    return null;
  },
});

export const revokeBySecret = internalMutation({
  args: { agentConnectionId: v.string(), agentConnectionSecret: v.string() },
  returns: v.union(
    v.object({ ok: v.literal(true), status: v.literal("revoked") }),
    v.object({ ok: v.literal(false) }),
  ),
  handler: async (ctx, args) => {
    const connection = await connectionBySecret(
      ctx,
      args.agentConnectionId,
      args.agentConnectionSecret,
    );
    if (!connection) return { ok: false as const };
    if (connection.status !== "revoked") {
      const now = Date.now();
      await ctx.db.patch("agentConnections", connection._id, {
        status: "revoked",
        revokedAt: now,
        revocationReason: "agent_revoked",
      });
      const staged =
        connection.status === "active"
          ? await ctx.db
              .query("agentConnections")
              .withIndex("by_agentId_status", (q) =>
                q.eq("agentId", connection.agentId).eq("status", "staged"),
              )
              .collect()
          : [];
      for (const row of staged) {
        await ctx.db.patch("agentConnections", row._id, {
          status: "revoked",
          revokedAt: now,
          revocationReason: "agent_revoked",
        });
      }
    }
    return { ok: true as const, status: "revoked" as const };
  },
});

export const cancelInvite = internalMutation({
  args: { claimHandle: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const invite = await inviteByClaim(ctx, args.claimHandle);
    if (!invite || invite.status !== "pending") return false;
    if ((await projectConnectionHandoff(ctx, invite, null, Date.now())).reason)
      return false;
    await ctx.db.patch("agentConnectionInvites", invite._id, {
      status: "expired",
      terminalReason: "agent_cancelled",
      issuedSecretCipher: "",
    });
    return true;
  },
});

export const replacementOptionsPage = authenticatedQuery({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(
    v.object({ id: v.id("agentConnections"), name: v.string() }),
  ),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("agentConnections")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", ctx.userId).eq("status", "active"),
      )
      .order("desc")
      .paginate(args.paginationOpts);
    return {
      ...page,
      page: page.page.map((row) => ({ id: row._id, name: row.name })),
    };
  },
});

export const acknowledgeClaim = internalMutation({
  args: { claimHandle: v.string(), agentConnectionSecret: v.string() },
  returns: v.union(
    v.object({
      ok: v.literal(true),
      acknowledgedAt: v.number(),
      resourceStatus: v.union(v.literal("active"), v.literal("revoked")),
    }),
    denyResultValidator,
  ),
  handler: async (ctx, args) => {
    const invite = await inviteByClaim(ctx, args.claimHandle);
    if (!invite) return denyCreate(401, "Unknown claim handle", "UNAUTHORIZED");
    if (!invite.agentConnectionId)
      return denyCreate(403, "Connection claim unavailable", "EXPIRED");
    const connection = await ctx.db.get(
      "agentConnections",
      invite.agentConnectionId,
    );
    if (
      !connection ||
      !hashesEqual(
        connection.secretHash,
        await sha256Hex(args.agentConnectionSecret),
      )
    )
      return denyCreate(401, "Invalid connection credentials", "UNAUTHORIZED");
    if (invite.claimAcknowledgedAt)
      return {
        ok: true as const,
        acknowledgedAt: invite.claimAcknowledgedAt,
        resourceStatus:
          connection.status === "active" &&
          (await lineage(ctx, connection.agentId))?.revokedAt === undefined
            ? ("active" as const)
            : ("revoked" as const),
      };
    const handoff = await projectConnectionHandoff(
      ctx,
      invite,
      connection,
      Date.now(),
    );
    const terminal = connectionTerminalDenial(handoff);
    if (terminal) return terminal;
    if (invite.replacesAgentConnectionId)
      return denyCreate(
        409,
        "Activate this replacement connection",
        "ACTIVATION_REQUIRED",
        invite.activationDeadlineAt
          ? {
              completionPath: "/api/agent-connections/activate",
              completionDeadlineAt: invite.activationDeadlineAt,
            }
          : undefined,
      );
    if (
      handoff.handoffStatus !== "waiting_for_ack" ||
      connection.status !== "staged"
    )
      return denyCreate(403, "Acknowledgment unavailable", "EXPIRED");
    const now = Date.now();
    await ctx.db.patch("agentConnections", connection._id, {
      status: "active",
    });
    await ctx.db.patch("agentConnectionInvites", invite._id, {
      claimAcknowledgedAt: now,
      issuedSecretCipher: "",
    });
    return {
      ok: true as const,
      acknowledgedAt: now,
      resourceStatus: "active" as const,
    };
  },
});
