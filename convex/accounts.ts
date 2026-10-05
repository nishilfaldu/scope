import { omit } from "convex-helpers";
import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";
import {
  query,
  mutation,
  internalMutation,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import {
  actor,
  verifiedActor,
  owner,
  service,
  canonicalScopes,
  sameScopes,
  authorizationKey,
  disconnectOutcome,
} from "./scope";
import { randomSecret, hashesEqual } from "./lib/secrets";
import schema from "./schema";
import type { Doc } from "./_generated/dataModel";
const view = schema
  .doc("connectedAccounts")
  .omit("proofHash", "authorizationKey");
async function owned(
  ctx: QueryCtx | MutationCtx,
  id: Doc<"connectedAccounts">["_id"],
) {
  const ownerId = await owner(ctx),
    row = await ctx.db.get("connectedAccounts", id);
  if (!row || row.ownerId !== ownerId) throw new Error("Account unavailable");
  return row;
}
async function conflict(
  ctx: QueryCtx | MutationCtx,
  row: Doc<"connectedAccounts">,
  key = row.authorizationKey,
) {
  if (!key) return null;
  const rows = await ctx.db
    .query("connectedAccounts")
    .withIndex("by_authorizationKey_and_provisional_and_visible", (q) =>
      q
        .eq("authorizationKey", key)
        .eq("provisional", false)
        .eq("visible", true),
    )
    .take(2);
  return rows.find((r) => r._id !== row._id) ?? null;
}
export const forOwner = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(view),
  handler: async (ctx, args) => {
    const id = await owner(ctx);
    const page = await ctx.db
      .query("connectedAccounts")
      .withIndex("by_ownerId_and_visible_and_state", (q) =>
        q.eq("ownerId", id).eq("visible", true),
      )
      .order("desc")
      .paginate(args.paginationOpts);
    return {
      ...page,
      page: page.page.map((r) => omit(r, ["proofHash", "authorizationKey"])),
    };
  },
});
export const listForClient = query({
  args: { ...actor.fields, paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(
    v.object({
      id: v.id("connectedAccounts"),
      providerId: v.string(),
      label: v.string(),
      grantVersion: v.number(),
      grantedScopes: v.array(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    await verifiedActor(ctx, args);
    const page = await ctx.db
      .query("connectedAccounts")
      .withIndex("by_ownerId_and_visible_and_state", (q) =>
        q.eq("ownerId", args.subject).eq("visible", true).eq("state", "active"),
      )
      .order("desc")
      .paginate(args.paginationOpts);
    return {
      ...page,
      page: page.page.map((r) => ({
        id: r._id,
        providerId: r.providerId,
        label: r.label,
        grantVersion: r.grantVersion,
        grantedScopes: r.grantedScopes,
      })),
    };
  },
});
export const beginConnection = mutation({
  args: {
    secret: v.string(),
    providerId: v.string(),
    providerName: v.string(),
    connectorId: v.string(),
    issuer: v.string(),
    requestedScopes: v.array(v.string()),
    proofHash: v.string(),
  },
  returns: v.object({ id: v.id("connectedAccounts"), subjectId: v.string() }),
  handler: async (ctx, args) => {
    service(args.secret);
    const ownerId = await owner(ctx);
    const scopes = canonicalScopes(args.requestedScopes);
    if (
      !/^[a-z][a-z0-9-]{0,63}$/.test(args.providerId) ||
      !args.providerName.trim() ||
      args.providerName.length > 100 ||
      !args.connectorId ||
      !args.issuer.startsWith("https://") ||
      !/^[a-f0-9]{64}$/.test(args.proofHash)
    )
      throw new Error("Invalid input");
    const subjectId = randomSecret(`scope:${ownerId}:grant:`),
      expiresAt = Date.now() + 10 * 60_000;
    const id = await ctx.db.insert("connectedAccounts", {
      ownerId,
      visible: true,
      provisional: true,
      providerId: args.providerId,
      providerName: args.providerName,
      label: `Unfinished ${args.providerName} connection`,
      accessDescription: scopes.join(", "),
      connect: {
        connectorId: args.connectorId,
        subjectId,
        issuer: args.issuer,
      },
      grantedScopes: [],
      grantVersion: 1,
      state: "connecting",
      requestedScopes: scopes,
      proofHash: args.proofHash,
      setupExpiresAt: expiresAt,
    });
    await ctx.scheduler.runAt(expiresAt, internal.accounts.expireSetup, {
      id,
      deadline: expiresAt,
    });
    return { id, subjectId };
  },
});
export const setupForOwner = query({
  args: {
    secret: v.string(),
    id: v.id("connectedAccounts"),
    proofHash: v.optional(v.string()),
  },
  returns: schema.doc("connectedAccounts"),
  handler: async (ctx, args) => {
    service(args.secret);
    const row = await owned(ctx, args.id);
    if (
      args.proofHash !== undefined &&
      (!row.proofHash || !hashesEqual(row.proofHash, args.proofHash))
    )
      throw new Error("Connection unavailable");
    return row;
  },
});
export const completeConnection = mutation({
  args: {
    secret: v.string(),
    id: v.id("connectedAccounts"),
    proofHash: v.optional(v.string()),
    activate: v.boolean(),
    providerUserId: v.string(),
    providerTenantId: v.optional(v.string()),
    label: v.string(),
    installationId: v.optional(v.string()),
    grantedScopes: v.array(v.string()),
  },
  returns: v.object({
    accountId: v.id("connectedAccounts"),
    active: v.boolean(),
    issue: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    service(args.secret);
    const row = await owned(ctx, args.id);
    if (
      args.proofHash !== undefined &&
      (!row.proofHash || !hashesEqual(row.proofHash, args.proofHash))
    )
      throw new Error("Connection unavailable");
    if (
      !args.providerUserId ||
      (args.installationId !== undefined &&
        (!args.installationId || args.installationId === "*")) ||
      !args.label.trim() ||
      args.label.length > 200
    )
      throw new Error("Invalid grant");
    const scopes = args.grantedScopes.length
        ? canonicalScopes(args.grantedScopes)
        : [],
      key = authorizationKey(
        row.providerId,
        args.providerUserId,
        args.providerTenantId,
        row.connect.connectorId,
      );
    if (!row.provisional) {
      if (
        row.state !== "active" ||
        row.authorizationKey !== key ||
        row.connect.installationId !== args.installationId ||
        !sameScopes(row.grantedScopes, scopes)
      )
        throw new Error("Connection changed");
      return { accountId: row._id, active: true };
    }
    const issue =
      !row.visible || row.disconnectOutcome === "succeeded"
        ? "setup-closed"
        : (await conflict(ctx, row, key))
          ? "grant-conflict"
          : !args.activate || row.setupExpiresAt! <= Date.now()
            ? "setup-expired"
            : undefined;
    await ctx.db.patch("connectedAccounts", row._id, {
      visible: true,
      providerUserId: args.providerUserId,
      providerTenantId: args.providerTenantId,
      label: args.label.trim(),
      connect: { ...row.connect, installationId: args.installationId },
      authorizationKey: key,
      grantedScopes: scopes,
      state: issue ? "blocked" : "active",
      provisional: !!issue,
      setupIssue: issue,
      disconnectOutcome: issue ? "failed" : undefined,
    });
    return { accountId: row._id, active: !issue, issue };
  },
});
export const setupFailed = mutation({
  args: {
    secret: v.string(),
    id: v.id("connectedAccounts"),
    issue: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    service(args.secret);
    const row = await owned(ctx, args.id);
    if (row.provisional && row.disconnectOutcome !== "succeeded")
      await ctx.db.patch("connectedAccounts", row._id, {
        state: "blocked",
        setupIssue: args.issue,
        disconnectOutcome: "failed",
      });
    return null;
  },
});
export const block = mutation({
  args: {
    secret: v.string(),
    id: v.id("connectedAccounts"),
    grantVersion: v.number(),
  },
  returns: schema.doc("connectedAccounts"),
  handler: async (ctx, { secret, id, grantVersion }) => {
    service(secret);
    const row = await owned(ctx, id);
    if (row.grantVersion !== grantVersion) throw new Error("Account changed");
    if (
      row.provisional &&
      (!row.authorizationKey || (await conflict(ctx, row)))
    )
      throw new Error("Connection recovery required");
    if (row.disconnectOutcome !== "succeeded") {
      await ctx.db.patch("connectedAccounts", id, {
        state: "blocked",
        blockedAt: row.blockedAt ?? Date.now(),
        disconnectOutcome: "pending",
      });
      await ctx.scheduler.runAfter(0, internal.access.closeAccount, { id });
    }
    return (await ctx.db.get("connectedAccounts", id))!;
  },
});
export const recordDisconnect = mutation({
  args: {
    secret: v.string(),
    id: v.id("connectedAccounts"),
    grantVersion: v.number(),
    outcome: disconnectOutcome,
  },
  returns: disconnectOutcome,
  handler: async (ctx, args) => {
    service(args.secret);
    const row = await owned(ctx, args.id);
    if (row.state !== "blocked" || row.grantVersion !== args.grantVersion)
      throw new Error("Account changed");
    if (row.disconnectOutcome === "succeeded") return "succeeded" as const;
    await ctx.db.patch("connectedAccounts", row._id, {
      disconnectOutcome: args.outcome,
      visible: args.outcome !== "succeeded",
    });
    return args.outcome;
  },
});
export const abandonWithoutGrant = mutation({
  args: { secret: v.string(), id: v.id("connectedAccounts") },
  returns: v.null(),
  handler: async (ctx, args) => {
    service(args.secret);
    const row = await owned(ctx, args.id);
    if (!row.provisional || row.connect.installationId)
      throw new Error("Account changed");
    await ctx.db.patch("connectedAccounts", row._id, {
      state: "blocked",
      visible: false,
      disconnectOutcome: "succeeded",
    });
    return null;
  },
});
export const expireSetup = internalMutation({
  args: { id: v.id("connectedAccounts"), deadline: v.number() },
  returns: v.null(),
  handler: async (ctx, { id, deadline }) => {
    const row = await ctx.db.get("connectedAccounts", id);
    if (
      row?.state === "connecting" &&
      row.setupExpiresAt === deadline &&
      deadline <= Date.now()
    )
      await ctx.db.patch("connectedAccounts", id, {
        state: "blocked",
        setupIssue: "setup-expired",
        disconnectOutcome: "failed",
      });
    return null;
  },
});
