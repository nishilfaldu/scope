import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v, type Infer } from "convex/values";
import { query, mutation, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  actor,
  clientActor,
  connectReference,
  decision,
  owner,
  snapshot,
  command,
  sameScopes,
  type Ctx,
} from "./scope";
import { hashesEqual, randomSecret } from "./lib/secrets";
import { validCommand } from "../shared/contracts.mjs";
import { retrier } from "./notifications";

const context = v.object({
  id: v.id("approvalRequests"),
  accountId: v.id("connectedAccounts"),
  providerId: v.string(),
  grantVersion: v.number(),
  requesterConnectionId: v.id("clientConnections"),
  reason: v.string(),
  command,
  snapshot,
});
const ownerView = context.omit("id").extend({
  _id: v.id("approvalRequests"),
  createdAt: v.number(),
  status: decision,
  approvalExpiresAt: v.number(),
  decidedAt: v.optional(v.number()),
  stoppedAt: v.optional(v.number()),
  deliveredAt: v.optional(v.number()),
  lastDeliveryAt: v.optional(v.number()),
  receivedAt: v.optional(v.number()),
  providerExpiresAt: v.optional(v.number()),
  accountAvailable: v.boolean(),
  accountBlockedAt: v.optional(v.number()),
  requesterStopped: v.boolean(),
  requesterStoppedAt: v.optional(v.number()),
});
const acquiredAccount = connectReference.extend({
  accountId: v.id("connectedAccounts"),
  providerId: v.string(),
  label: v.string(),
  providerUserId: v.string(),
  providerTenantId: v.optional(v.string()),
  grantVersion: v.number(),
  grantedScopes: v.array(v.string()),
});
const state = v.union(
  v.literal("pending"),
  v.literal("denied"),
  v.literal("cancelled"),
  v.literal("expired"),
  v.literal("unavailable"),
);
function requestContext(r: Doc<"approvalRequests">) {
  return {
    id: r._id,
    accountId: r.accountId,
    providerId: r.providerId,
    grantVersion: r.grantVersion,
    requesterConnectionId: r.requesterConnectionId,
    reason: r.reason,
    command: r.command,
    snapshot: r.snapshot,
  };
}
function sameCommand(a: Infer<typeof command>, b: Infer<typeof command>) {
  return (
    a.cwd === b.cwd &&
    a.envVar === b.envVar &&
    a.argv.length === b.argv.length &&
    a.argv.every((arg, i) => arg === b.argv[i])
  );
}
async function authority(ctx: Ctx, r: Doc<"approvalRequests">) {
  const [account, requester] = await Promise.all([
    ctx.db.get("connectedAccounts", r.accountId),
    ctx.db.get("clientConnections", r.requesterConnectionId),
  ]);
  const accountAvailable =
    !!account &&
    account.ownerId === r.ownerId &&
    account.state === "active" &&
    account.grantVersion === r.grantVersion &&
    account.providerId === r.providerId &&
    sameScopes(account.grantedScopes, r.snapshot.grantedScopes);
  const requesterLive =
    !!requester &&
    requester.ownerId === r.ownerId &&
    requester.stoppedAt === undefined;
  return { account, requester, accountAvailable, requesterLive };
}
async function presentation(ctx: QueryCtx, r: Doc<"approvalRequests">) {
  const a = await authority(ctx, r),
    { id: _id, ...rest } = requestContext(r);
  return {
    ...rest,
    _id,
    createdAt: r._creationTime,
    status: r.status,
    approvalExpiresAt: r.approvalExpiresAt,
    decidedAt: r.decidedAt,
    stoppedAt: r.stoppedAt,
    deliveredAt: r.firstDeliveryAt,
    lastDeliveryAt: r.lastDeliveryAt,
    receivedAt: r.receivedAt,
    providerExpiresAt: r.providerExpiresAt,
    accountAvailable: a.accountAvailable,
    accountBlockedAt: a.account?.blockedAt,
    requesterStopped: !a.requesterLive,
    requesterStoppedAt: a.requester?.stoppedAt,
  };
}
export const listAccounts = query({
  args: actor.fields,
  returns: v.array(
    v.object({
      id: v.id("connectedAccounts"),
      providerId: v.string(),
      label: v.string(),
      grantVersion: v.number(),
      grantedScopes: v.array(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    await clientActor(ctx, args);
    const rows = await ctx.db
      .query("connectedAccounts")
      .withIndex("by_ownerId_and_state_and_disconnectOutcome", (q) =>
        q.eq("ownerId", args.subject).eq("state", "active"),
      )
      .take(100);
    return rows.map((r) => ({
      id: r._id,
      providerId: r.providerId,
      label: r.label,
      grantVersion: r.grantVersion,
      grantedScopes: r.grantedScopes,
    }));
  },
});
export const request = mutation({
  args: {
    ...actor.fields,
    key: v.string(),
    accountId: v.id("connectedAccounts"),
    reason: v.string(),
    command,
  },
  returns: v.object({
    id: v.id("approvalRequests"),
    status: decision,
    approvalExpiresAt: v.number(),
    created: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const requester = await clientActor(ctx, args);
    if (
      !/^[\w-]{16,128}$/.test(args.key) ||
      !args.reason.trim() ||
      args.reason.length > 1000 ||
      !validCommand(args.command)
    )
      throw new Error("Invalid request");
    const old = await ctx.db
      .query("approvalRequests")
      .withIndex("by_requesterConnectionId_and_key", (q) =>
        q.eq("requesterConnectionId", requester._id).eq("key", args.key),
      )
      .unique();
    if (old) {
      if (
        old.ownerId !== args.subject ||
        old.accountId !== args.accountId ||
        old.reason !== args.reason.trim() ||
        !sameCommand(old.command, args.command)
      )
        throw new Error("Idempotency conflict");
      return {
        id: old._id,
        status: old.status,
        approvalExpiresAt: old.approvalExpiresAt,
        created: false,
      };
    }
    const account = await ctx.db.get("connectedAccounts", args.accountId);
    if (
      !account ||
      account.ownerId !== args.subject ||
      account.state !== "active"
    )
      throw new Error("Account unavailable");
    const pending = await ctx.db
      .query("approvalRequests")
      .withIndex("by_status_and_ownerId_and_approvalExpiresAt", (q) =>
        q
          .eq("status", "pending")
          .eq("ownerId", args.subject)
          .gt("approvalExpiresAt", Date.now()),
      )
      .take(50);
    if (pending.length >= 50) throw new Error("Pending request limit");
    const approvalExpiresAt = Date.now() + 30 * 60_000;
    const id = await ctx.db.insert("approvalRequests", {
      ownerId: args.subject,
      requesterConnectionId: requester._id,
      accountId: account._id,
      key: args.key,
      providerId: account.providerId,
      grantVersion: account.grantVersion,
      snapshot: {
        accountLabel: account.label,
        providerName: account.providerName,
        accessDescription: account.accessDescription,
        requesterName: requester.name,
        grantedScopes: account.grantedScopes,
      },
      reason: args.reason.trim(),
      command: args.command,
      status: "pending",
      approvalExpiresAt,
    });
    const subscriptions = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", args.subject))
      .take(10);
    for (const subscription of subscriptions)
      await retrier.run(ctx, internal.notificationDelivery.deliver, {
        requestId: id,
        subscriptionId: subscription._id,
      });
    return { id, status: "pending" as const, approvalExpiresAt, created: true };
  },
});
export const status = query({
  args: { ...actor.fields, id: v.id("approvalRequests") },
  returns: context.extend({
    status: decision,
    approvalExpiresAt: v.number(),
    accountAvailable: v.boolean(),
    requesterStopped: v.boolean(),
    receivedAt: v.optional(v.number()),
  }),
  handler: async (ctx, args) => {
    const caller = await clientActor(ctx, args),
      r = await ctx.db.get("approvalRequests", args.id);
    if (
      !r ||
      r.ownerId !== args.subject ||
      r.requesterConnectionId !== caller._id
    )
      throw new Error("Request unavailable");
    const a = await authority(ctx, r);
    return {
      ...requestContext(r),
      status: r.status,
      approvalExpiresAt: r.approvalExpiresAt,
      accountAvailable: a.accountAvailable,
      requesterStopped: !a.requesterLive,
      receivedAt: r.receivedAt,
    };
  },
});
export const preflight = query({
  args: { ...actor.fields, id: v.id("approvalRequests"), now: v.number() },
  returns: v.union(
    v.object({ status: state }),
    context.extend({
      status: v.literal("acquire"),
      account: acquiredAccount,
      approvalExpiresAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const caller = await clientActor(ctx, args),
      r = await ctx.db.get("approvalRequests", args.id);
    if (
      !r ||
      r.ownerId !== args.subject ||
      r.requesterConnectionId !== caller._id
    )
      throw new Error("Request unavailable");
    const a = await authority(ctx, r);
    if (!a.accountAvailable || !a.requesterLive || !a.account)
      return { status: "unavailable" as const };
    if (!Number.isFinite(args.now) || r.approvalExpiresAt <= args.now)
      return { status: "expired" as const };
    if (r.status !== "approved") return { status: r.status };
    return {
      ...requestContext(r),
      status: "acquire" as const,
      account: {
        ...a.account.connect,
        accountId: a.account._id,
        label: r.snapshot.accountLabel,
        providerId: r.providerId,
        providerUserId: a.account.providerUserId,
        providerTenantId: a.account.providerTenantId,
        grantVersion: r.grantVersion,
        grantedScopes: r.snapshot.grantedScopes,
      },
      approvalExpiresAt: r.approvalExpiresAt,
    };
  },
});
export const authorizeDelivery = mutation({
  args: {
    ...actor.fields,
    id: v.id("approvalRequests"),
    grantVersion: v.number(),
    grantedScopes: v.array(v.string()),
    providerExpiresAt: v.optional(v.number()),
    tokenId: v.optional(v.string()),
  },
  returns: v.object({
    approvalExpiresAt: v.number(),
    receiptProof: v.string(),
  }),
  handler: async (ctx, args) => {
    const caller = await clientActor(ctx, args),
      r = await ctx.db.get("approvalRequests", args.id);
    if (
      !r ||
      r.ownerId !== args.subject ||
      r.requesterConnectionId !== caller._id
    )
      throw new Error("Request unavailable");
    const a = await authority(ctx, r);
    if (
      r.status !== "approved" ||
      r.approvalExpiresAt <= Date.now() ||
      !a.accountAvailable ||
      !a.requesterLive ||
      args.grantVersion !== r.grantVersion ||
      !sameScopes(args.grantedScopes, r.snapshot.grantedScopes) ||
      (args.providerExpiresAt !== undefined &&
        (!Number.isFinite(args.providerExpiresAt) ||
          args.providerExpiresAt <= Date.now()))
    )
      throw new Error("Delivery unavailable");
    const receiptProof = r.receiptProof ?? randomSecret("receipt_"),
      now = Date.now();
    await ctx.db.patch("approvalRequests", r._id, {
      receiptProof,
      firstDeliveryAt: r.firstDeliveryAt ?? now,
      lastDeliveryAt: now,
      deliveryAttempts: (r.deliveryAttempts ?? 0) + 1,
      providerExpiresAt: args.providerExpiresAt,
      tokenId: args.tokenId,
    });
    return { approvalExpiresAt: r.approvalExpiresAt, receiptProof };
  },
});
export const acknowledge = mutation({
  args: {
    ...actor.fields,
    id: v.id("approvalRequests"),
    receiptProof: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const caller = await clientActor(ctx, args, true),
      r = await ctx.db.get("approvalRequests", args.id);
    if (
      !r ||
      r.ownerId !== args.subject ||
      r.requesterConnectionId !== caller._id ||
      r.firstDeliveryAt === undefined ||
      !r.receiptProof ||
      !hashesEqual(r.receiptProof, args.receiptProof)
    )
      throw new Error("Receipt unavailable");
    if (r.receivedAt === undefined)
      await ctx.db.patch("approvalRequests", r._id, { receivedAt: Date.now() });
    return null;
  },
});
export const decide = mutation({
  args: { id: v.id("approvalRequests"), approve: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ownerId = await owner(ctx),
      r = await ctx.db.get("approvalRequests", args.id);
    if (!r || r.ownerId !== ownerId || r.approvalExpiresAt <= Date.now())
      throw new Error("Request unavailable");
    if (r.status !== "pending") {
      if (r.status === (args.approve ? "approved" : "denied")) return null;
      throw new Error("Already decided");
    }
    const a = await authority(ctx, r);
    if (args.approve && (!a.accountAvailable || !a.requesterLive))
      throw new Error("Request unavailable");
    await ctx.db.patch("approvalRequests", r._id, {
      status: args.approve ? "approved" : "denied",
      decidedAt: Date.now(),
    });
    return null;
  },
});
export const cancel = mutation({
  args: { id: v.id("approvalRequests") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const ownerId = await owner(ctx),
      r = await ctx.db.get("approvalRequests", id);
    if (!r || r.ownerId !== ownerId) throw new Error("Request unavailable");
    if (r.status !== "denied" && r.status !== "cancelled")
      await ctx.db.patch("approvalRequests", id, {
        status: "cancelled",
        stoppedAt: Date.now(),
      });
    return null;
  },
});
export const forOwner = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(ownerView),
  handler: async (ctx, args) => {
    const ownerId = await owner(ctx),
      result = await ctx.db
        .query("approvalRequests")
        .withIndex("by_ownerId", (q) => q.eq("ownerId", ownerId))
        .order("desc")
        .paginate(args.paginationOpts);
    return {
      ...result,
      page: await Promise.all(result.page.map((r) => presentation(ctx, r))),
    };
  },
});
export const pendingForOwner = query({
  args: { now: v.number() },
  returns: v.array(ownerView),
  handler: async (ctx, { now }) => {
    const ownerId = await owner(ctx),
      rows = await ctx.db
        .query("approvalRequests")
        .withIndex("by_status_and_ownerId_and_approvalExpiresAt", (q) =>
          q
            .eq("status", "pending")
            .eq("ownerId", ownerId)
            .gt("approvalExpiresAt", now),
        )
        .take(50);
    return Promise.all(rows.map((r) => presentation(ctx, r)));
  },
});
export const retainedForOwner = query({
  args: { ids: v.array(v.id("approvalRequests")) },
  returns: v.array(ownerView),
  handler: async (ctx, { ids }) => {
    const ownerId = await owner(ctx);
    if (ids.length > 50) throw new Error("Too many requests");
    const rows = await Promise.all(
      ids.map((id) => ctx.db.get("approvalRequests", id)),
    );
    return Promise.all(
      rows
        .filter(
          (r): r is Doc<"approvalRequests"> =>
            r !== null && r.ownerId === ownerId,
        )
        .map((r) => presentation(ctx, r)),
    );
  },
});
export const requestForOwner = query({
  args: { reference: v.string() },
  returns: v.union(v.null(), ownerView),
  handler: async (ctx, { reference }) => {
    const ownerId = await owner(ctx),
      id = ctx.db.normalizeId("approvalRequests", reference);
    if (!id) return null;
    const r = await ctx.db.get("approvalRequests", id);
    return r?.ownerId === ownerId ? presentation(ctx, r) : null;
  },
});

export const cancelForClient = mutation({
  args: { ...actor.fields, id: v.id("approvalRequests") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const caller = await clientActor(ctx, args),
      row = await ctx.db.get("approvalRequests", args.id);
    if (
      !row ||
      row.ownerId !== args.subject ||
      row.requesterConnectionId !== caller._id
    )
      throw new Error("Request unavailable");
    if (row.status !== "denied" && row.status !== "cancelled")
      await ctx.db.patch("approvalRequests", row._id, {
        status: "cancelled",
        stoppedAt: Date.now(),
      });
    return null;
  },
});
