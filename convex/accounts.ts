import { v } from "convex/values";
import { query, mutation, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  connectReference,
  disconnectOutcome,
  owner,
  service,
  canonicalScopes,
  sameScopes,
  authorizationKey,
} from "./scope";
import { randomSecret, hashesEqual } from "./lib/secrets";

const view = v.object({
  _id: v.id("connectedAccounts"),
  providerId: v.string(),
  providerName: v.string(),
  label: v.string(),
  accessDescription: v.string(),
  providerUserId: v.string(),
  providerTenantId: v.optional(v.string()),
  providerEmail: v.optional(v.string()),
  grantedScopes: v.array(v.string()),
  state: v.union(v.literal("active"), v.literal("blocked")),
  blockedAt: v.optional(v.number()),
  grantVersion: v.number(),
  disconnectOutcome: v.optional(disconnectOutcome),
});
export const forOwner = query({
  args: {},
  returns: v.array(view),
  handler: async (ctx) => {
    const ownerId = await owner(ctx),
      groups = await Promise.all([
        ctx.db
          .query("connectedAccounts")
          .withIndex("by_ownerId_and_state_and_disconnectOutcome", (q) =>
            q.eq("ownerId", ownerId).eq("state", "active"),
          )
          .order("desc")
          .take(100),
        ...([undefined, "pending", "failed"] as const).map((outcome) =>
          ctx.db
            .query("connectedAccounts")
            .withIndex("by_ownerId_and_state_and_disconnectOutcome", (q) =>
              q
                .eq("ownerId", ownerId)
                .eq("state", "blocked")
                .eq("disconnectOutcome", outcome),
            )
            .order("desc")
            .take(100),
        ),
      ]),
      rows = groups
        .flat()
        .sort((a, b) => b._creationTime - a._creationTime)
        .slice(0, 100);
    return rows.map((r) => ({
      _id: r._id,
      providerId: r.providerId,
      providerName: r.providerName,
      label: r.label,
      accessDescription: r.accessDescription,
      providerUserId: r.providerUserId,
      providerTenantId: r.providerTenantId,
      providerEmail: r.providerEmail,
      grantedScopes: r.grantedScopes,
      state: r.state,
      blockedAt: r.blockedAt,
      grantVersion: r.grantVersion,
      disconnectOutcome: r.disconnectOutcome,
    }));
  },
});
export const beginConnection = mutation({
  args: {
    secret: v.string(),
    providerId: v.string(),
    providerName: v.string(),
    accessDescription: v.string(),
    connectorId: v.string(),
    issuer: v.string(),
    requestedScopes: v.array(v.string()),
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
    const ownerId = await owner(ctx),
      requestedScopes = canonicalScopes(args.requestedScopes);
    if (
      ![
        args.providerId,
        args.providerName,
        args.accessDescription,
        args.connectorId,
        args.issuer,
      ].every((s) => s.trim()) ||
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
        target.providerId !== args.providerId ||
        target.state !== "blocked" ||
        target.disconnectOutcome !== "succeeded")
    )
      throw new Error("Revoke the previous authorization first");
    const subjectId = randomSecret("scope_grant_"),
      expiresAt = Date.now() + 10 * 60_000;
    const id = await ctx.db.insert("connectionAttempts", {
      ownerId,
      providerId: args.providerId,
      providerName: args.providerName,
      accessDescription: args.accessDescription,
      connect: {
        connectorId: args.connectorId,
        subjectId,
        issuer: args.issuer,
      },
      requestedScopes,
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
    providerId: v.string(),
    connect: connectReference,
    requestedScopes: v.array(v.string()),
    expiresAt: v.number(),
    accountId: v.optional(v.id("connectedAccounts")),
  }),
  handler: async (ctx, args) => {
    service(args.secret);
    const ownerId = await owner(ctx),
      row = await ctx.db.get("connectionAttempts", args.id);
    if (
      !row ||
      row.ownerId !== ownerId ||
      !hashesEqual(row.proofHash, args.proofHash)
    )
      throw new Error("Connection unavailable");
    if (row.accountId) {
      const account = await ctx.db.get("connectedAccounts", row.accountId);
      if (
        !account ||
        account.ownerId !== ownerId ||
        account.state !== "active" ||
        account.providerId !== row.providerId ||
        !sameScopes(account.grantedScopes, row.requestedScopes) ||
        account.connect.subjectId !== row.connect.subjectId ||
        account.connect.connectorId !== row.connect.connectorId ||
        account.connect.issuer !== row.connect.issuer ||
        account.connect.installationId !== row.connect.installationId
      )
        throw new Error("Account identity changed");
    }
    return {
      id: row._id,
      providerId: row.providerId,
      connect: row.connect,
      requestedScopes: row.requestedScopes,
      expiresAt: row.expiresAt,
      accountId: row.accountId,
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
    installationId: v.optional(v.string()),
    grantedScopes: v.array(v.string()),
  },
  returns: v.object({ accountId: v.id("connectedAccounts") }),
  handler: async (ctx, args) => {
    service(args.secret);
    const ownerId = await owner(ctx),
      row = await ctx.db.get("connectionAttempts", args.id);
    if (
      !row ||
      row.ownerId !== ownerId ||
      !hashesEqual(row.proofHash, args.proofHash) ||
      row.expiresAt <= Date.now()
    )
      throw new Error("Connection unavailable");
    const grantedScopes = canonicalScopes(args.grantedScopes);
    if (!sameScopes(grantedScopes, row.requestedScopes))
      throw new Error("Provider permissions differ from connector permissions");
    if (
      !args.providerUserId.trim() ||
      !args.label.trim() ||
      args.label.length > 200 ||
      (args.installationId !== undefined &&
        (!args.installationId.trim() || args.installationId === "*"))
    )
      throw new Error("Invalid provider grant");
    const connect = { ...row.connect, installationId: args.installationId };
    if (row.accountId) {
      const old = await ctx.db.get("connectedAccounts", row.accountId);
      if (
        !old ||
        old.ownerId !== ownerId ||
        old.state !== "active" ||
        old.connect.subjectId !== row.connect.subjectId ||
        old.connect.connectorId !== row.connect.connectorId ||
        old.connect.issuer !== row.connect.issuer ||
        old.providerId !== row.providerId ||
        !sameScopes(old.grantedScopes, grantedScopes) ||
        old.providerUserId !== args.providerUserId ||
        old.providerTenantId !== args.providerTenantId ||
        old.connect.installationId !== args.installationId
      )
        throw new Error("Account identity changed");
      return { accountId: old._id };
    }
    // An index key keeps user/workspace/connector isolation bounded without
    // exposing a provider-specific identity model to the approval engine.
    const key = authorizationKey(
      row.providerId,
      args.providerUserId,
      args.providerTenantId,
      row.connect.connectorId,
    );
    for (const outcome of [undefined, "pending", "failed"] as const) {
      const surviving = await ctx.db
        .query("connectedAccounts")
        .withIndex("by_authorizationKey_and_disconnectOutcome", (q) =>
          q.eq("authorizationKey", key).eq("disconnectOutcome", outcome),
        )
        .first();
      if (surviving && surviving._id !== row.targetAccountId)
        throw new Error("Revoke the previous authorization first");
    }
    const values = {
      ownerId,
      authorizationKey: key,
      providerId: row.providerId,
      providerName: row.providerName,
      accessDescription: row.accessDescription,
      connect,
      providerUserId: args.providerUserId,
      providerTenantId: args.providerTenantId,
      label: args.label.trim(),
      providerEmail: args.providerEmail,
      grantedScopes,
      state: "active" as const,
    };
    let accountId;
    if (row.targetAccountId) {
      const target = await ctx.db.get("connectedAccounts", row.targetAccountId);
      if (
        !target ||
        target.ownerId !== ownerId ||
        target.providerId !== row.providerId ||
        target.grantVersion !== row.targetGrantVersion ||
        target.state !== "blocked" ||
        target.disconnectOutcome !== "succeeded" ||
        target.providerUserId !== args.providerUserId ||
        target.providerTenantId !== args.providerTenantId
      )
        throw new Error("Account identity changed");
      accountId = target._id;
      await ctx.db.replace("connectedAccounts", accountId, {
        ...values,
        grantVersion: target.grantVersion + 1,
      });
    } else
      accountId = await ctx.db.insert("connectedAccounts", {
        ...values,
        grantVersion: 1,
      });
    await ctx.db.patch("connectionAttempts", row._id, { accountId, connect });
    return { accountId };
  },
});
export const block = mutation({
  args: { id: v.id("connectedAccounts"), grantVersion: v.number() },
  returns: v.object({
    disconnected: v.boolean(),
    accountId: v.id("connectedAccounts"),
    connect: connectReference,
    providerId: v.string(),
    grantVersion: v.number(),
    grantedScopes: v.array(v.string()),
    providerUserId: v.string(),
    providerTenantId: v.optional(v.string()),
  }),
  handler: async (ctx, { id, grantVersion }) => {
    const ownerId = await owner(ctx),
      row = await ctx.db.get("connectedAccounts", id);
    if (!row || row.ownerId !== ownerId || row.grantVersion !== grantVersion)
      throw new Error("Account unavailable");
    await ctx.db.patch("connectedAccounts", id, {
      state: "blocked",
      blockedAt: row.blockedAt ?? Date.now(),
      disconnectOutcome:
        row.disconnectOutcome === "succeeded" ? "succeeded" : "pending",
    });
    return {
      disconnected: row.disconnectOutcome === "succeeded",
      accountId: id,
      connect: row.connect,
      providerId: row.providerId,
      grantVersion: row.grantVersion,
      grantedScopes: row.grantedScopes,
      providerUserId: row.providerUserId,
      providerTenantId: row.providerTenantId,
    };
  },
});
export const recordDisconnect = mutation({
  args: {
    secret: v.string(),
    id: v.id("connectedAccounts"),
    grantVersion: v.number(),
    outcome: v.union(v.literal("succeeded"), v.literal("failed")),
  },
  returns: v.union(v.literal("succeeded"), v.literal("failed")),
  handler: async (ctx, args) => {
    service(args.secret);
    const ownerId = await owner(ctx),
      row = await ctx.db.get("connectedAccounts", args.id);
    if (
      !row ||
      row.ownerId !== ownerId ||
      row.state !== "blocked" ||
      row.grantVersion !== args.grantVersion
    )
      throw new Error("Account unavailable");
    if (row.disconnectOutcome !== "succeeded")
      await ctx.db.patch("connectedAccounts", row._id, {
        disconnectOutcome: args.outcome,
      });
    return row.disconnectOutcome === "succeeded" ? "succeeded" : args.outcome;
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
