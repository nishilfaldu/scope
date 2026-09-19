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

export const createInvite = internalMutation({
  args: { agentName: v.string() },
  returns: v.object({
    publicToken: v.string(),
    claimHandle: v.string(),
    expiresAt: v.number(),
    agentName: v.string(),
  }),
  handler: async (ctx, args) => {
    const agentName = args.agentName.trim();
    if (!agentName || agentName.length > 80)
      throw new Error("agentName must be 1 to 80 characters");
    const publicToken = randomSecret("ac_");
    const claimHandle = randomSecret("ach_");
    const expiresAt = Date.now() + INVITE_TTL_MS;
    await ctx.db.insert("agentConnectionInvites", {
      publicToken,
      claimSecretHash: await sha256Hex(claimHandle),
      agentName,
      status: "pending",
      expiresAt,
    });
    await ctx.scheduler.runAfter(
      INVITE_TTL_MS,
      internal.tables.agentConnections.expireInvite,
      { publicToken },
    );
    return { publicToken, claimHandle, expiresAt, agentName };
  },
});

const inviteView = v.object({
  agentName: v.string(),
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
      agentName: invite.agentName,
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
    const now = Date.now();
    if (args.decision === "denied") {
      await ctx.db.patch("agentConnectionInvites", invite._id, {
        status: "denied",
        userId: ctx.userId,
        decidedAt: now,
      });
      return null;
    }
    const secret = randomSecret("acs_");
    const agentConnectionId = await ctx.db.insert("agentConnections", {
      userId: ctx.userId,
      name: invite.agentName,
      secretHash: await sha256Hex(secret),
      status: "active",
    });
    await ctx.db.patch("agentConnectionInvites", invite._id, {
      status: "approved",
      userId: ctx.userId,
      agentConnectionId,
      issuedSecretCipher: await encryptToken(secret),
      decidedAt: now,
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
      claimedAt: Date.now(),
      issuedSecretCipher: "",
    });
    return {
      kind: "connected" as const,
      agentConnectionId: invite.agentConnectionId,
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
  status: v.union(v.literal("active"), v.literal("revoked")),
  lastUsedAt: v.optional(v.number()),
  revokedAt: v.optional(v.number()),
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
    return rows.map((row) => ({
      _id: row._id,
      _creationTime: row._creationTime,
      name: row.name,
      status: row.status,
      lastUsedAt: row.lastUsedAt,
      revokedAt: row.revokedAt,
    }));
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
