import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";
import { query, mutation, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  actor,
  clientActor,
  collectorEligible,
  connectReference,
  decision,
  owner,
  snapshot,
  type Ctx,
} from "./scope";
import { hashesEqual, randomSecret } from "./lib/secrets";

const context = v.object({
  id: v.id("approvalRequests"),
  accountId: v.id("connectedAccounts"),
  integrationId: v.string(),
  grantVersion: v.number(),
  profileId: v.string(),
  profileVersion: v.number(),
  requesterConnectionId: v.id("clientConnections"),
  collectorConnectionId: v.id("clientConnections"),
  reason: v.string(),
  intent: v.optional(v.string()),
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
  collectorStopped: v.boolean(),
  collectorStoppedAt: v.optional(v.number()),
});
const acquiredAccount = connectReference.extend({
  accountId: v.id("connectedAccounts"),
  integrationId: v.string(),
  label: v.string(),
  providerUserId: v.string(),
  providerTenantId: v.optional(v.string()),
  profileId: v.string(),
  profileVersion: v.number(),
  grantVersion: v.number(),
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
    integrationId: r.integrationId,
    grantVersion: r.grantVersion,
    profileId: r.profileId,
    profileVersion: r.profileVersion,
    requesterConnectionId: r.requesterConnectionId,
    collectorConnectionId: r.collectorConnectionId,
    reason: r.reason,
    intent: r.intent,
    snapshot: r.snapshot,
  };
}
async function authority(ctx: Ctx, r: Doc<"approvalRequests">) {
  const [account, requester, collector] = await Promise.all([
    ctx.db.get("connectedAccounts", r.accountId),
    ctx.db.get("clientConnections", r.requesterConnectionId),
    ctx.db.get("clientConnections", r.collectorConnectionId),
  ]);
  const accountAvailable =
    !!account &&
    account.ownerId === r.ownerId &&
    account.state === "active" &&
    account.grantVersion === r.grantVersion &&
    account.integrationId === r.integrationId &&
    account.profileId === r.profileId &&
    account.profileVersion === r.profileVersion;
  const requesterLive =
    !!requester &&
    requester.ownerId === r.ownerId &&
    requester.stoppedAt === undefined;
  const collectorLive =
    !!collector &&
    collector.ownerId === r.ownerId &&
    collector.stoppedAt === undefined &&
    collectorEligible(collector.clientId);
  return {
    account,
    requester,
    collector,
    accountAvailable,
    requesterLive,
    collectorLive,
  };
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
    collectorStopped: !a.collectorLive,
    collectorStoppedAt: a.collector?.stoppedAt,
  };
}
export const listAccounts = query({
  args: actor.fields,
  returns: v.array(
    v.object({
      id: v.id("connectedAccounts"),
      integrationId: v.string(),
      label: v.string(),
      profileId: v.string(),
      profileVersion: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    await clientActor(ctx, args);
    const rows = await ctx.db
      .query("connectedAccounts")
      .withIndex("by_ownerId_and_state", (q) =>
        q.eq("ownerId", args.userId).eq("state", "active"),
      )
      .take(100);
    return rows.map((r) => ({
      id: r._id,
      integrationId: r.integrationId,
      label: r.label,
      profileId: r.profileId,
      profileVersion: r.profileVersion,
    }));
  },
});
export const request = mutation({
  args: {
    ...actor.fields,
    key: v.string(),
    accountId: v.id("connectedAccounts"),
    reason: v.string(),
    intent: v.optional(v.string()),
    collectorConnectionId: v.optional(v.id("clientConnections")),
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
      (args.intent !== undefined &&
        (!args.intent.trim() || args.intent.length > 240))
    )
      throw new Error("Invalid request");
    const collectorId = args.collectorConnectionId ?? requester._id;
    const collector = await ctx.db.get("clientConnections", collectorId);
    if (
      !collector ||
      collector.ownerId !== args.userId ||
      collector.stoppedAt !== undefined ||
      !collectorEligible(collector.clientId)
    )
      throw new Error("Collector unavailable");
    const old = await ctx.db
      .query("approvalRequests")
      .withIndex("by_requesterConnectionId_and_key", (q) =>
        q.eq("requesterConnectionId", requester._id).eq("key", args.key),
      )
      .unique();
    if (old) {
      if (
        old.ownerId !== args.userId ||
        old.accountId !== args.accountId ||
        old.collectorConnectionId !== collectorId ||
        old.reason !== args.reason.trim() ||
        old.intent !== args.intent?.trim()
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
      account.ownerId !== args.userId ||
      account.state !== "active"
    )
      throw new Error("Account unavailable");
    const pending = await ctx.db
      .query("approvalRequests")
      .withIndex("by_ownerId_and_status_and_approvalExpiresAt", (q) =>
        q
          .eq("ownerId", args.userId)
          .eq("status", "pending")
          .gt("approvalExpiresAt", Date.now()),
      )
      .take(50);
    if (pending.length >= 50) throw new Error("Pending request limit");
    const approvalExpiresAt = Date.now() + 30 * 60_000;
    const id = await ctx.db.insert("approvalRequests", {
      ownerId: args.userId,
      accountId: account._id,
      requesterConnectionId: requester._id,
      collectorConnectionId: collectorId,
      key: args.key,
      integrationId: account.integrationId,
      grantVersion: account.grantVersion,
      profileId: account.profileId,
      profileVersion: account.profileVersion,
      snapshot: {
        accountLabel: account.label,
        providerName: account.providerName,
        accessDescription: account.accessDescription,
        providerEmail: account.providerEmail,
        baseName: account.baseName,
        requesterName: requester.name,
        collectorName: collector.name,
      },
      reason: args.reason.trim(),
      intent: args.intent?.trim(),
      status: "pending",
      approvalExpiresAt,
    });
    const subscriptions = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", args.userId))
      .take(10);
    for (const subscription of subscriptions) {
      const jobId = await ctx.db.insert("notificationJobs", {
        requestId: id,
        subscriptionId: subscription._id,
        status: "pending",
        attempts: 0,
      });
      await ctx.scheduler.runAfter(0, internal.notificationDelivery.deliver, {
        id: jobId,
      });
    }
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
    collectorStopped: v.boolean(),
    receivedAt: v.optional(v.number()),
  }),
  handler: async (ctx, args) => {
    const caller = await clientActor(ctx, args),
      r = await ctx.db.get("approvalRequests", args.id);
    if (
      !r ||
      r.ownerId !== args.userId ||
      (r.requesterConnectionId !== caller._id &&
        r.collectorConnectionId !== caller._id)
    )
      throw new Error("Request unavailable");
    const a = await authority(ctx, r);
    return {
      ...requestContext(r),
      status: r.status,
      approvalExpiresAt: r.approvalExpiresAt,
      accountAvailable: a.accountAvailable,
      requesterStopped: !a.requesterLive,
      collectorStopped: !a.collectorLive,
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
      r.ownerId !== args.userId ||
      r.collectorConnectionId !== caller._id ||
      !collectorEligible(caller.clientId)
    )
      throw new Error("Request unavailable");
    const a = await authority(ctx, r);
    if (
      !a.accountAvailable ||
      !a.requesterLive ||
      !a.collectorLive ||
      !a.account
    )
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
        integrationId: r.integrationId,
        providerUserId: a.account.providerUserId,
        providerTenantId: a.account.providerTenantId,
        profileId: r.profileId,
        profileVersion: r.profileVersion,
        grantVersion: r.grantVersion,
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
    profileId: v.string(),
    profileVersion: v.number(),
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
      r.ownerId !== args.userId ||
      r.collectorConnectionId !== caller._id ||
      !collectorEligible(caller.clientId)
    )
      throw new Error("Request unavailable");
    const a = await authority(ctx, r);
    if (
      r.status !== "approved" ||
      r.approvalExpiresAt <= Date.now() ||
      !a.accountAvailable ||
      !a.requesterLive ||
      !a.collectorLive ||
      args.grantVersion !== r.grantVersion ||
      args.profileId !== r.profileId ||
      args.profileVersion !== r.profileVersion ||
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
      r.ownerId !== args.userId ||
      r.collectorConnectionId !== caller._id ||
      !r.firstDeliveryAt ||
      !r.receiptProof ||
      !hashesEqual(r.receiptProof, args.receiptProof)
    )
      throw new Error("Receipt unavailable");
    // A receipt records a past response; it never renews authority or claims provider work completed.
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
    if (
      args.approve &&
      (!a.accountAvailable || !a.requesterLive || !a.collectorLive)
    )
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
        .withIndex("by_ownerId_and_status_and_approvalExpiresAt", (q) =>
          q
            .eq("ownerId", ownerId)
            .eq("status", "pending")
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
