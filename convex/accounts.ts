import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { query, mutation, internalMutation } from "./_generated/server";
import {
  connectReference,
  disconnectOutcome,
  owner,
  service,
  supersededGrant,
} from "./scope";
import { internal } from "./_generated/api";
import { randomSecret, hashesEqual } from "./lib/secrets";

const accountView = v.object({
  _id: v.id("connectedAccounts"),
  integrationId: v.string(),
  label: v.string(),
  providerName: v.string(),
  accessDescription: v.string(),
  providerUserId: v.string(),
  providerTenantId: v.optional(v.string()),
  providerEmail: v.optional(v.string()),
  baseName: v.optional(v.string()),
  state: v.union(v.literal("active"), v.literal("blocked")),
  blockedAt: v.optional(v.number()),
  grantVersion: v.number(),
  profileId: v.string(),
  profileVersion: v.number(),
  disconnectOutcome: v.optional(disconnectOutcome),
});
export const identity = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({ id: v.id("users"), email: v.string() }),
  ),
  handler: async (ctx) => {
    const id = await getAuthUserId(ctx);
    if (!id) return null;
    const r = await ctx.db.get("users", id);
    return r?.email ? { id, email: r.email } : null;
  },
});
export const forOwner = query({
  args: {},
  returns: v.array(accountView),
  handler: async (ctx) => {
    const ownerId = await owner(ctx);
    const rows = await ctx.db
      .query("connectedAccounts")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", ownerId))
      .order("desc")
      .take(100);
    return rows.map((r) => ({
      _id: r._id,
      integrationId: r.integrationId,
      label: r.label,
      providerName: r.providerName,
      accessDescription: r.accessDescription,
      providerUserId: r.providerUserId,
      providerTenantId: r.providerTenantId,
      providerEmail: r.providerEmail,
      baseName: r.baseName,
      state: r.state,
      blockedAt: r.blockedAt,
      grantVersion: r.grantVersion,
      profileId: r.profileId,
      profileVersion: r.profileVersion,
      disconnectOutcome: r.disconnectOutcome,
    }));
  },
});
export const beginConnection = mutation({
  args: {
    secret: v.string(),
    integrationId: v.string(),
    providerName: v.string(),
    accessDescription: v.string(),
    connectorId: v.string(),
    issuer: v.string(),
    profileId: v.string(),
    profileVersion: v.number(),
    proofHash: v.string(),
    targetAccountId: v.optional(v.id("connectedAccounts")),
  },
  returns: v.object({
    id: v.id("connectionAttempts"),
    subjectId: v.string(),
    connectorId: v.string(),
    expiresAt: v.number(),
  }),
  handler: async (ctx, args) => {
    service(args.secret);
    const ownerId = await owner(ctx);
    if (
      ![
        args.integrationId,
        args.providerName,
        args.accessDescription,
        args.connectorId,
        args.issuer,
        args.profileId,
      ].every((s) => s.trim()) ||
      !Number.isInteger(args.profileVersion) ||
      args.profileVersion < 1 ||
      !/^[a-f0-9]{64}$/.test(args.proofHash)
    )
      throw new Error("Invalid connection");
    const target = args.targetAccountId
      ? await ctx.db.get("connectedAccounts", args.targetAccountId)
      : null;
    if (
      args.targetAccountId &&
      (!target ||
        target.ownerId !== ownerId ||
        target.integrationId !== args.integrationId)
    )
      throw new Error("Account unavailable");
    const subjectId = randomSecret("scope_grant_"),
      expiresAt = Date.now() + 10 * 60_000;
    const id = await ctx.db.insert("connectionAttempts", {
      ownerId,
      integrationId: args.integrationId,
      providerName: args.providerName,
      accessDescription: args.accessDescription,
      connect: {
        connectorId: args.connectorId,
        subjectId,
        issuer: args.issuer,
      },
      profileId: args.profileId,
      profileVersion: args.profileVersion,
      proofHash: args.proofHash,
      targetAccountId: args.targetAccountId,
      targetGrantVersion: target?.grantVersion,
      expiresAt,
    });
    await ctx.scheduler.runAt(expiresAt, internal.accounts.expireAttempt, {
      id,
    });
    return { id, subjectId, connectorId: args.connectorId, expiresAt };
  },
});
export const connectionAttempt = query({
  args: {
    secret: v.string(),
    id: v.id("connectionAttempts"),
    proofHash: v.string(),
  },
  returns: v.object({
    id: v.id("connectionAttempts"),
    integrationId: v.string(),
    connect: connectReference,
    profileId: v.string(),
    profileVersion: v.number(),
    expiresAt: v.number(),
    accountId: v.optional(v.id("connectedAccounts")),
    superseded: v.optional(supersededGrant),
  }),
  handler: async (ctx, args) => {
    service(args.secret);
    const ownerId = await owner(ctx),
      r = await ctx.db.get("connectionAttempts", args.id);
    if (
      !r ||
      r.ownerId !== ownerId ||
      !hashesEqual(r.proofHash, args.proofHash)
    )
      throw new Error("Connection unavailable");
    if (r.accountId) {
      const account = await ctx.db.get("connectedAccounts", r.accountId);
      if (
        !account ||
        account.ownerId !== ownerId ||
        account.state !== "active" ||
        account.integrationId !== r.integrationId ||
        account.profileId !== r.profileId ||
        account.profileVersion !== r.profileVersion ||
        account.connect.subjectId !== r.connect.subjectId ||
        account.connect.connectorId !== r.connect.connectorId ||
        account.connect.issuer !== r.connect.issuer ||
        account.connect.installationId !== r.connect.installationId
      )
        throw new Error("Account identity changed");
    }
    // Completion mutation checks time; queries do not read the wall clock.
    return {
      id: r._id,
      integrationId: r.integrationId,
      connect: r.connect,
      profileId: r.profileId,
      profileVersion: r.profileVersion,
      expiresAt: r.expiresAt,
      accountId: r.accountId,
      superseded: r.superseded,
    };
  },
});
export const completeConnection = mutation({
  args: {
    secret: v.string(),
    id: v.id("connectionAttempts"),
    proofHash: v.string(),
    providerUserId: v.string(),
    providerTenantId: v.optional(v.string()),
    label: v.string(),
    providerEmail: v.optional(v.string()),
    baseName: v.optional(v.string()),
    installationId: v.optional(v.string()),
    grantedScopes: v.array(v.string()),
  },
  returns: v.object({
    accountId: v.id("connectedAccounts"),
    superseded: v.optional(supersededGrant),
  }),
  handler: async (ctx, args) => {
    service(args.secret);
    const ownerId = await owner(ctx),
      r = await ctx.db.get("connectionAttempts", args.id);
    if (
      !r ||
      r.ownerId !== ownerId ||
      !hashesEqual(r.proofHash, args.proofHash) ||
      r.expiresAt <= Date.now()
    )
      throw new Error("Connection unavailable");
    if (
      !args.providerUserId.trim() ||
      !args.label.trim() ||
      args.label.length > 200 ||
      (args.installationId !== undefined &&
        (!args.installationId.trim() || args.installationId === "*"))
    )
      throw new Error("Invalid provider grant");
    const connect = { ...r.connect, installationId: args.installationId };
    if (r.accountId) {
      const old = await ctx.db.get("connectedAccounts", r.accountId);
      if (
        !old ||
        old.ownerId !== ownerId ||
        old.state !== "active" ||
        old.connect.subjectId !== r.connect.subjectId ||
        old.providerUserId !== args.providerUserId ||
        old.providerTenantId !== args.providerTenantId ||
        old.connect.installationId !== args.installationId
      )
        throw new Error("Account identity changed");
      return { accountId: old._id, superseded: r.superseded };
    }
    const values = {
      ownerId,
      integrationId: r.integrationId,
      providerName: r.providerName,
      accessDescription: r.accessDescription,
      connect,
      profileId: r.profileId,
      profileVersion: r.profileVersion,
      providerUserId: args.providerUserId,
      providerTenantId: args.providerTenantId,
      label: args.label.trim(),
      providerEmail: args.providerEmail,
      baseName: args.baseName,
      grantedScopes: args.grantedScopes,
      state: "active" as const,
    };
    let accountId;
    let superseded;
    if (r.targetAccountId) {
      const target = await ctx.db.get("connectedAccounts", r.targetAccountId);
      if (
        !target ||
        target.ownerId !== ownerId ||
        target.integrationId !== r.integrationId ||
        target.grantVersion !== r.targetGrantVersion ||
        target.providerUserId !== args.providerUserId ||
        target.providerTenantId !== args.providerTenantId
      )
        throw new Error("Account identity changed");
      accountId = target._id;
      superseded = {
        integrationId: target.integrationId,
        connect: target.connect,
        profileId: target.profileId,
        profileVersion: target.profileVersion,
      };
      await ctx.db.replace("connectedAccounts", accountId, {
        ...values,
        grantVersion: target.grantVersion + 1,
      });
    } else
      accountId = await ctx.db.insert("connectedAccounts", {
        ...values,
        grantVersion: 1,
      });
    // Keep cleanup retryable after a lost callback response. This reference is
    // nonsecret and survives only for the attempt's original ten-minute window;
    // expiry does not guarantee Connect/provider revocation completed.
    await ctx.db.patch("connectionAttempts", r._id, {
      accountId,
      connect,
      superseded,
    });
    return { accountId, superseded };
  },
});
export const block = mutation({
  args: { id: v.id("connectedAccounts") },
  returns: v.object({
    accountId: v.id("connectedAccounts"),
    connect: connectReference,
    integrationId: v.string(),
    grantVersion: v.number(),
  }),
  handler: async (ctx, { id }) => {
    const ownerId = await owner(ctx),
      r = await ctx.db.get("connectedAccounts", id);
    if (!r || r.ownerId !== ownerId) throw new Error("Account unavailable");
    await ctx.db.patch("connectedAccounts", id, {
      state: "blocked",
      blockedAt: r.blockedAt ?? Date.now(),
    });
    return {
      accountId: id,
      connect: r.connect,
      integrationId: r.integrationId,
      grantVersion: r.grantVersion,
    };
  },
});
export const recordDisconnect = mutation({
  args: {
    secret: v.string(),
    id: v.id("connectedAccounts"),
    grantVersion: v.number(),
    outcome: disconnectOutcome,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    service(args.secret);
    const ownerId = await owner(ctx),
      r = await ctx.db.get("connectedAccounts", args.id);
    if (
      !r ||
      r.ownerId !== ownerId ||
      r.state !== "blocked" ||
      r.grantVersion !== args.grantVersion
    )
      throw new Error("Account unavailable");
    await ctx.db.patch("connectedAccounts", r._id, {
      disconnectOutcome: args.outcome,
    });
    return null;
  },
});

export const expireAttempt = internalMutation({
  args: { id: v.id("connectionAttempts") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get("connectionAttempts", id);
    if (row && row.expiresAt <= Date.now())
      await ctx.db.delete("connectionAttempts", id);
    return null;
  },
});

export const acknowledgeSupersededCleanup = mutation({
  args: {
    secret: v.string(),
    id: v.id("connectionAttempts"),
    proofHash: v.string(),
    subjectId: v.string(),
    outcome: v.literal("succeeded"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    service(args.secret);
    const ownerId = await owner(ctx),
      row = await ctx.db.get("connectionAttempts", args.id);
    if (
      !row ||
      row.ownerId !== ownerId ||
      row.expiresAt <= Date.now() ||
      !hashesEqual(row.proofHash, args.proofHash)
    )
      throw new Error("Connection unavailable");
    if (!row.superseded) return null;
    if (row.superseded.connect.subjectId !== args.subjectId)
      throw new Error("Superseded grant unavailable");
    await ctx.db.patch("connectionAttempts", row._id, {
      superseded: undefined,
    });
    return null;
  },
});
