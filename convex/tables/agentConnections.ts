import { v } from "convex/values";
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
import { effectiveStatus } from "./slices/helpers";

const INVITE_TTL_MS = 15 * 60 * 1000;

export async function activeAgentConnection(
  ctx: QueryCtx | MutationCtx,
  connectionId: string,
  secret: string,
) {
  const id = ctx.db.normalizeId("agentConnections", connectionId);
  const connection = id ? await ctx.db.get("agentConnections", id) : null;
  if (!connection || connection.status !== "active") return null;
  return hashesEqual(connection.secretHash, await sha256Hex(secret))
    ? connection
    : null;
}

async function agentConnectionBySecret(
  ctx: QueryCtx | MutationCtx,
  connectionId: string,
  secret: string,
) {
  const id = ctx.db.normalizeId("agentConnections", connectionId);
  const connection = id ? await ctx.db.get("agentConnections", id) : null;
  if (!connection) return null;
  return hashesEqual(connection.secretHash, await sha256Hex(secret))
    ? connection
    : null;
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
    expiresAt: v.number(),
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
    const previous =
      args.previousConnectionId && args.previousConnectionSecret
        ? await agentConnectionBySecret(
            ctx,
            args.previousConnectionId,
            args.previousConnectionSecret,
          )
        : null;
    if (args.previousConnectionId && !previous) {
      throw new Error("Invalid previous agent connection");
    }
    if (previous) {
      const latest = await ctx.db
        .query("agentConnections")
        .withIndex("by_user_agent", (q) =>
          q.eq("userId", previous.userId).eq("agentId", previous.agentId),
        )
        .order("desc")
        .first();
      if (latest?._id !== previous._id) {
        throw new Error("Only the latest agent connection can reconnect");
      }
    }
    const agentName = previous?.name ?? args.agentName.trim();
    if (!agentName || agentName.length > 80)
      throw new Error("agentName must be 1 to 80 characters");
    const publicToken = randomSecret("ac_");
    const claimHandle = randomSecret("ach_");
    const expiresAt = Date.now() + INVITE_TTL_MS;
    const agentId = previous?.agentId ?? randomSecret("ag_");
    await ctx.db.insert("agentConnectionInvites", {
      publicToken,
      claimSecretHash: await sha256Hex(claimHandle),
      agentId,
      agentName,
      status: "pending",
      expiresAt,
      userId: previous?.userId,
      replacesAgentConnectionId: previous?._id,
    });
    await ctx.scheduler.runAfter(
      INVITE_TTL_MS,
      internal.tables.agentConnections.expireInvite,
      { publicToken },
    );
    return {
      publicToken,
      claimHandle,
      expiresAt,
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
  expiresAt: v.number(),
});

export const getInvite = authenticatedQuery({
  args: { publicToken: v.string() },
  returns: v.union(inviteView, v.null()),
  handler: async (ctx, args) => {
    const invite = await ctx.db
      .query("agentConnectionInvites")
      .withIndex("by_public_token", (q) =>
        q.eq("publicToken", args.publicToken),
      )
      .unique();
    if (!invite || (invite.userId && invite.userId !== ctx.userId)) return null;
    return {
      agentId: invite.agentId,
      agentName: invite.agentName,
      reconnecting: invite.replacesAgentConnectionId !== undefined,
      status:
        (invite.status === "pending" || invite.status === "approved") &&
        invite.expiresAt <= Date.now()
          ? ("expired" as const)
          : invite.status,
      expiresAt: invite.expiresAt,
    };
  },
});

export const decideInvite = authenticatedMutation({
  args: {
    publicToken: v.string(),
    decision: v.union(v.literal("approved"), v.literal("denied")),
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
      invite.expiresAt <= Date.now()
    ) {
      throw new Error("Connection link is no longer available");
    }
    if (invite.userId && invite.userId !== ctx.userId) {
      throw new Error("This reconnect link belongs to another Scope account");
    }
    if (args.decision === "denied") {
      await ctx.db.patch("agentConnectionInvites", invite._id, {
        status: "denied",
        userId: ctx.userId,
      });
      return null;
    }
    if (invite.replacesAgentConnectionId) {
      const latest = await ctx.db
        .query("agentConnections")
        .withIndex("by_user_agent", (q) =>
          q.eq("userId", ctx.userId).eq("agentId", invite.agentId),
        )
        .order("desc")
        .first();
      if (latest?._id !== invite.replacesAgentConnectionId) {
        throw new Error("This reconnect link has been superseded");
      }
    }
    const activeConnections = await ctx.db
      .query("agentConnections")
      .withIndex("by_user_agent_status", (q) =>
        q
          .eq("userId", ctx.userId)
          .eq("agentId", invite.agentId)
          .eq("status", "active"),
      )
      .take(2);
    if (activeConnections.length > 1) {
      throw new Error("Agent has more than one active connection");
    }
    const now = Date.now();
    if (activeConnections[0]) {
      await ctx.db.patch("agentConnections", activeConnections[0]._id, {
        status: "revoked",
        revokedAt: now,
      });
    }
    const secret = randomSecret("acs_");
    const agentConnectionId = await ctx.db.insert("agentConnections", {
      userId: ctx.userId,
      agentId: invite.agentId,
      name: invite.agentName,
      secretHash: await sha256Hex(secret),
      status: "active",
    });
    await ctx.db.patch("agentConnectionInvites", invite._id, {
      status: "approved",
      userId: ctx.userId,
      agentConnectionId,
      issuedSecretCipher: await encryptToken(secret),
    });
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
  args: { claimHandle: v.string() },
  returns: v.union(
    v.object({
      status: v.union(
        v.literal("pending"),
        v.literal("approved"),
        v.literal("denied"),
        v.literal("claimed"),
        v.literal("expired"),
      ),
      expiresAt: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const invite = await inviteByClaim(ctx, args.claimHandle);
    if (!invite) return null;
    return {
      status:
        (invite.status === "pending" || invite.status === "approved") &&
        invite.expiresAt <= Date.now()
          ? ("expired" as const)
          : invite.status,
      expiresAt: invite.expiresAt,
    };
  },
});

export const claim = internalMutation({
  args: { claimHandle: v.string() },
  returns: v.union(
    v.object({ kind: v.literal("pending"), expiresAt: v.number() }),
    v.object({
      kind: v.literal("connected"),
      agentId: v.string(),
      agentConnectionId: v.id("agentConnections"),
      agentConnectionSecret: v.string(),
      agentName: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const invite = await inviteByClaim(ctx, args.claimHandle);
    if (!invite) throw new Error("Unknown claim handle");
    if (invite.expiresAt <= Date.now()) {
      throw new Error("Connection invite has expired");
    }
    if (invite.status === "pending" && invite.expiresAt > Date.now()) {
      return { kind: "pending" as const, expiresAt: invite.expiresAt };
    }
    if (
      invite.status !== "approved" ||
      !invite.agentConnectionId ||
      !invite.issuedSecretCipher
    ) {
      throw new Error("Connection invite is unavailable");
    }
    const agentConnectionSecret = await decryptToken(invite.issuedSecretCipher);
    await ctx.db.patch("agentConnectionInvites", invite._id, {
      status: "claimed",
      issuedSecretCipher: "",
    });
    return {
      kind: "connected" as const,
      agentConnectionId: invite.agentConnectionId,
      agentId: invite.agentId,
      agentConnectionSecret,
      agentName: invite.agentName,
    };
  },
});

export const expireInvite = internalMutation({
  args: { publicToken: v.string() },
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
      invite.expiresAt > Date.now() ||
      (invite.status !== "pending" && invite.status !== "approved")
    ) {
      return null;
    }
    if (invite.agentConnectionId) {
      await ctx.db.patch("agentConnections", invite.agentConnectionId, {
        status: "revoked",
        revokedAt: Date.now(),
      });
    }
    await ctx.db.patch("agentConnectionInvites", invite._id, {
      status: "expired",
      issuedSecretCipher: "",
    });
    return null;
  },
});

const boardConnection = v.object({
  _id: v.id("agentConnections"),
  _creationTime: v.number(),
  name: v.string(),
  agentId: v.string(),
  status: v.union(v.literal("active"), v.literal("revoked")),
  lastUsedAt: v.optional(v.number()),
  revokedAt: v.optional(v.number()),
  slices: v.array(
    v.object({
      _id: v.id("slices"),
      name: v.string(),
      status: v.union(
        v.literal("active"),
        v.literal("revoked"),
        v.literal("expired"),
      ),
      expiresAt: v.number(),
    }),
  ),
});

export const list = authenticatedQuery({
  args: {},
  returns: v.array(boardConnection),
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("agentConnections")
      .withIndex("by_user", (q) => q.eq("userId", ctx.userId))
      .order("desc")
      .take(100);
    return await Promise.all(
      rows.map(async (row) => {
        const slices = await ctx.db
          .query("slices")
          .withIndex("by_agentConnectionId", (q) =>
            q.eq("agentConnectionId", row._id),
          )
          .collect();
        return {
          _id: row._id,
          _creationTime: row._creationTime,
          name: row.name,
          agentId: row.agentId,
          status: row.status,
          lastUsedAt: row.lastUsedAt,
          revokedAt: row.revokedAt,
          slices: slices.map((slice) => ({
            _id: slice._id,
            name: slice.name,
            status:
              row.status === "revoked"
                ? ("revoked" as const)
                : effectiveStatus(slice),
            expiresAt: slice.expiresAt,
          })),
        };
      }),
    );
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
    if (connection.status === "revoked") return null;
    const now = Date.now();
    await ctx.db.patch("agentConnections", connection._id, {
      status: "revoked",
      revokedAt: now,
    });
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
    const connection = await agentConnectionBySecret(
      ctx,
      args.agentConnectionId,
      args.agentConnectionSecret,
    );
    if (!connection) return { ok: false as const };
    if (connection.status !== "revoked") {
      await ctx.db.patch("agentConnections", connection._id, {
        status: "revoked",
        revokedAt: Date.now(),
      });
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
    await ctx.db.patch("agentConnectionInvites", invite._id, {
      status: "expired",
      expiresAt: Date.now(),
      issuedSecretCipher: "",
    });
    return true;
  },
});
