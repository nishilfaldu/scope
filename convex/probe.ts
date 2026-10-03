import type { Doc } from "./_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import {
  mutation,
  internalMutation,
  query,
  env,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server";
import { hashesEqual, randomSecret } from "./lib/secrets";
import { internal } from "./_generated/api";

async function owner(ctx: QueryCtx | MutationCtx) {
  const id = await getAuthUserId(ctx);
  if (!id) throw new Error("Sign in required");
  return id;
}
function service(secret: string) {
  const expected = env.SCOPE_PROBE_SECRET;
  if (!expected || !hashesEqual(expected, secret))
    throw new Error("Unauthorized");
}
const agentArgs = {
  secret: v.string(),
  userId: v.id("users"),
  requester: v.string(),
};

// The bridge authenticates the credential. Recheck live connection authority in
// each transaction, including after Connect's asynchronous provider call.
async function authorizeActor(
  ctx: QueryCtx | MutationCtx,
  args: { secret: string; userId: string; requester: string },
) {
  service(args.secret);
  // Direct Scope secrets cannot be exchanged for MCP authorization. Old
  // approvals stay bound to their retired recipient, never to a new sign-in.
  if (args.requester.startsWith("scope-agent:"))
    throw new Error("Unauthorized");
  const connection = await ctx.db
    .query("probeRequesters")
    .withIndex("by_requester", (q) => q.eq("requester", args.requester))
    .unique();
  if (
    connection &&
    (connection.userId !== args.userId || connection.stoppedAt !== undefined)
  )
    throw new Error("Unauthorized");
}

export const agentStatus = query({
  args: { ...agentArgs, id: v.id("probeRequests") },
  returns: v.object({
    status: v.string(),
    expiresAt: v.number(),
    revoked: v.boolean(),
  }),
  handler: async (ctx, args) => {
    await authorizeActor(ctx, args);
    const row = await ctx.db.get("probeRequests", args.id);
    if (!row || row.userId !== args.userId || row.requester !== args.requester)
      throw new Error("Request unavailable");
    const account = await ctx.db.get("probeAccounts", row.accountId);
    return {
      status: row.status,
      expiresAt: row.expiresAt,
      revoked: !account || account.revoked,
    };
  },
});

export const identity = query({
  args: {},
  returns: v.union(
    v.object({ id: v.id("users"), email: v.string() }),
    v.null(),
  ),
  handler: async (ctx) => {
    const id = await getAuthUserId(ctx);
    if (!id) return null;
    const user = await ctx.db.get("users", id);
    return user?.email ? { id, email: user.email } : null;
  },
});
export const account = query({
  args: { id: v.id("probeAccounts") },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    const userId = await owner(ctx);
    const row = await ctx.db.get("probeAccounts", id);
    if (!row || row.userId !== userId) throw new Error("Account unavailable");
    return row;
  },
});
export const revokeAccount = mutation({
  args: { id: v.id("probeAccounts") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const userId = await owner(ctx);
    const row = await ctx.db.get("probeAccounts", id);
    if (!row || row.userId !== userId) throw new Error("Account unavailable");
    await ctx.db.patch("probeAccounts", id, {
      revoked: true,
      blockedAt: row.blockedAt ?? Date.now(),
    });
    return null;
  },
});
export const dashboard = query({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    const userId = await owner(ctx);
    const accounts = await ctx.db
      .query("probeAccounts")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(100);
    const requests = await ctx.db
      .query("probeRequests")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(100);
    const credentials = await ctx.db
      .query("probeCredentials")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(100);
    return {
      accounts,
      requests: requests.map(
        ({
          lease: _lease,
          deliveryCipher: _cipher,
          receiptId: _receipt,
          ...r
        }) => {
          void _lease;
          void _cipher;
          void _receipt;
          return r;
        },
      ),
      credentials: credentials.map((c) => ({
        id: c._id,
        accountId: c.accountId,
        expiresAt: c.expiresAt,
        recipients: [
          ...new Set(
            requests
              .filter((r) => r.credentialId === c._id)
              .map((r) => r.requester),
          ),
        ],
      })),
    };
  },
});
export const decide = mutation({
  args: { id: v.id("probeRequests"), approve: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { id, approve }) => {
    const userId = await owner(ctx);
    const r = await ctx.db.get("probeRequests", id);
    if (!r || r.userId !== userId || r.expiresAt <= Date.now())
      throw new Error("Request unavailable");
    if (r.status !== "pending") {
      if (r.status === (approve ? "approved" : "denied")) return null;
      throw new Error("Already decided");
    }
    const a = await ctx.db.get("probeAccounts", r.accountId);
    if (approve && (await ownerRequestPresentation(ctx, r)).requesterStopped)
      throw new Error("Connection stopped");
    if (approve && (!a || a.revoked || !a.providerUserId))
      throw new Error("Account unavailable");
    await ctx.db.patch("probeRequests", id, {
      status: approve ? "approved" : "denied",
      decidedAt: Date.now(),
    });
    return null;
  },
});
export const request = mutation({
  args: {
    ...agentArgs,
    key: v.string(),
    accountId: v.id("probeAccounts"),
    reason: v.string(),
    intent: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await authorizeActor(ctx, args);
    if (
      !/^[\w-]{16,128}$/.test(args.key) ||
      !args.reason.trim() ||
      args.reason.length > 1000 ||
      (args.intent !== undefined &&
        (!args.intent.trim() || args.intent.length > 240))
    )
      throw new Error("Invalid request");
    const account = await ctx.db.get("probeAccounts", args.accountId);
    if (
      !account ||
      account.userId !== args.userId ||
      account.revoked ||
      !account.providerUserId
    )
      throw new Error("Account unavailable");
    const old = await ctx.db
      .query("probeRequests")
      .withIndex("by_requester_key", (q) =>
        q.eq("requester", args.requester).eq("key", args.key),
      )
      .unique();
    if (old) {
      if (
        old.userId !== args.userId ||
        old.accountId !== args.accountId ||
        old.reason !== args.reason ||
        (old.intent !== undefined &&
          args.intent !== undefined &&
          old.intent !== args.intent)
      )
        throw new Error("Idempotency conflict");
      return {
        id: old._id,
        status: old.status,
        expiresAt: old.expiresAt,
        created: false,
      };
    }
    const pending = await ctx.db
      .query("probeRequests")
      .withIndex("by_user_status_deadline", (q) =>
        q
          .eq("userId", args.userId)
          .eq("status", "pending")
          .gt("expiresAt", Date.now()),
      )
      .take(50);
    if (pending.length >= 50) throw new Error("Pending request limit");
    if (!args.requester.startsWith("scope-agent:")) {
      const connection = await ctx.db
        .query("probeRequesters")
        .withIndex("by_requester", (q) => q.eq("requester", args.requester))
        .unique();
      if (!connection)
        await ctx.db.insert("probeRequesters", {
          userId: args.userId,
          requester: args.requester,
          name: "MCP connection",
        });
    }
    const expiresAt = Date.now() + 30 * 60_000;
    const id = await ctx.db.insert("probeRequests", {
      userId: args.userId,
      requester: args.requester,
      key: args.key,
      accountId: args.accountId,
      reason: args.reason,
      intent: args.intent?.trim(),
      status: "pending",
      expiresAt,
    });
    const subscriptions = await ctx.db
      .query("probePush")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .take(10);
    for (const subscription of subscriptions) {
      const jobId = await ctx.db.insert("probeNotifications", {
        requestId: id,
        subscriptionId: subscription._id,
        status: "pending",
        attempts: 0,
      });
      await ctx.scheduler.runAfter(0, internal.probeNotifications.deliver, {
        id: jobId,
      });
    }
    return { id, status: "pending", expiresAt, created: true };
  },
});
export const claim = mutation({
  args: { ...agentArgs, id: v.id("probeRequests") },
  returns: v.any(),
  handler: async (ctx, args) => {
    await authorizeActor(ctx, args);
    const r = await ctx.db.get("probeRequests", args.id);
    if (!r || r.userId !== args.userId || r.requester !== args.requester)
      throw new Error("Request unavailable");
    const a = await ctx.db.get("probeAccounts", r.accountId);
    if (!a || a.revoked) throw new Error("Account unavailable");
    if (r.expiresAt <= Date.now()) return { status: "expired" };
    if (r.status !== "approved") return { status: r.status };
    if (r.credentialId) {
      const c = await ctx.db.get("probeCredentials", r.credentialId);
      const expiresAt = r.deliveryExpiresAt ?? c?.expiresAt;
      const cipher = r.deliveryCipher ?? c?.cipher;
      if (!c || !cipher || !expiresAt || expiresAt <= Date.now() + 30_000)
        return { status: "expired" };
      const receiptId = r.receiptId ?? randomSecret("receipt_");
      await ctx.db.patch("probeRequests", r._id, {
        receiptId,
        deliveredAt: r.deliveredAt ?? Date.now(),
        deliveryAttempts: (r.deliveryAttempts ?? 0) + 1,
      });
      if (c.cipher)
        await ctx.scheduler.runAt(
          c.expiresAt,
          internal.probe.clearLegacyCipher,
          { id: c._id },
        );
      return {
        status: "ready",
        cipher,
        expiresAt,
        receiptId,
        account: a,
        approvalExpiresAt: r.expiresAt,
      };
    }
    if (r.leaseUntil && r.leaseUntil > Date.now())
      return { status: "acquiring" };
    const lease = randomSecret("lease_");
    await ctx.db.patch("probeRequests", r._id, {
      lease,
      leaseUntil: Date.now() + 30_000,
    });
    return { status: "acquire", lease, account: a };
  },
});
export const finalize = mutation({
  args: {
    ...agentArgs,
    id: v.id("probeRequests"),
    lease: v.string(),
    cipher: v.string(),
    fingerprint: v.string(),
    expiresAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await authorizeActor(ctx, args);
    const r = await ctx.db.get("probeRequests", args.id);
    const a = r ? await ctx.db.get("probeAccounts", r.accountId) : null;
    if (
      !r ||
      r.userId !== args.userId ||
      r.requester !== args.requester ||
      r.status !== "approved" ||
      r.expiresAt <= Date.now() ||
      r.lease !== args.lease ||
      !r.leaseUntil ||
      r.leaseUntil <= Date.now() ||
      !a ||
      a.revoked ||
      !Number.isFinite(args.expiresAt) ||
      args.expiresAt <= Date.now() + 30_000
    )
      throw new Error("Delivery unavailable");
    const old = await ctx.db
      .query("probeCredentials")
      .withIndex("by_account_fingerprint", (q) =>
        q.eq("accountId", r.accountId).eq("fingerprint", args.fingerprint),
      )
      .unique();
    const credentialId = old
      ? old._id
      : await ctx.db.insert("probeCredentials", {
          userId: r.userId,
          accountId: r.accountId,
          fingerprint: args.fingerprint,
          expiresAt: args.expiresAt,
        });
    // History groups identical bytes; each decision retains its own immutable
    // delivery deadline/cipher so a later Connect response cannot extend it.
    await ctx.db.patch("probeRequests", r._id, {
      credentialId,
      deliveryCipher: args.cipher,
      deliveryExpiresAt: args.expiresAt,
      receiptId: randomSecret("receipt_"),
      cleanupAt: Math.min(r.expiresAt, args.expiresAt),
      lease: undefined,
      leaseUntil: undefined,
    });
    await ctx.scheduler.runAt(
      Math.min(r.expiresAt, args.expiresAt),
      internal.probe.clearDelivery,
      { id: r._id },
    );
    return null;
  },
});
export const subscribe = mutation({
  args: { endpoint: v.string(), p256dh: v.string(), auth: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await owner(ctx);
    const url = new URL(args.endpoint);
    if (
      url.protocol !== "https:" ||
      !(
        url.hostname === "fcm.googleapis.com" ||
        url.hostname.endsWith(".push.services.mozilla.com") ||
        url.hostname.endsWith(".push.apple.com")
      )
    )
      throw new Error("Unsupported push service");
    const rows = await ctx.db
      .query("probePush")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(10);
    const old = rows.find((r) => r.endpoint === args.endpoint);
    if (old) await ctx.db.patch("probePush", old._id, args);
    else {
      if (rows.length >= 10) throw new Error("Subscription limit");
      await ctx.db.insert("probePush", { ...args, userId });
    }
    return null;
  },
});
export const subscriptions = query({
  args: { secret: v.string(), userId: v.id("users") },
  returns: v.any(),
  handler: async (ctx, args) => {
    service(args.secret);
    return ctx.db
      .query("probePush")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .take(10);
  },
});

export const acknowledge = mutation({
  args: { ...agentArgs, id: v.id("probeRequests"), receiptId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await authorizeActor(ctx, args);
    const r = await ctx.db.get("probeRequests", args.id);
    if (
      !r ||
      r.userId !== args.userId ||
      r.requester !== args.requester ||
      !r.deliveredAt ||
      !r.receiptId ||
      !hashesEqual(r.receiptId, args.receiptId)
    )
      throw new Error("Receipt unavailable");
    // Receipt is historical evidence, not renewed authority.
    if (!r.receivedAt)
      await ctx.db.patch("probeRequests", r._id, { receivedAt: Date.now() });
    return null;
  },
});
export const cancel = mutation({
  args: { id: v.id("probeRequests") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const userId = await owner(ctx);
    const r = await ctx.db.get("probeRequests", id);
    if (!r || r.userId !== userId) throw new Error("Request unavailable");
    if (r.status === "denied" || r.status === "cancelled") return null;
    await ctx.db.patch("probeRequests", id, {
      status: "cancelled",
      stoppedAt: Date.now(),
      deliveryCipher: undefined,
      lease: undefined,
      leaseUntil: undefined,
    });
    return null;
  },
});
export const credentialDeliveries = query({
  args: {
    id: v.id("probeCredentials"),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.any(),
  handler: async (ctx, { id, paginationOpts }) => {
    const userId = await owner(ctx);
    const c = await ctx.db.get("probeCredentials", id);
    if (!c || c.userId !== userId) throw new Error("Credential unavailable");
    const result = await ctx.db
      .query("probeRequests")
      .withIndex("by_credential", (q) => q.eq("credentialId", id))
      .order("desc")
      .paginate(paginationOpts);
    return {
      ...result,
      page: result.page.map((r) => ({
        id: r._id,
        requester: r.requester,
        reason: r.reason,
        status: r.status,
        decidedAt: r.decidedAt,
        deliveredAt: r.deliveredAt,
        receivedAt: r.receivedAt,
        deliveryAttempts: r.deliveryAttempts ?? 0,
        expiresAt: r.deliveryExpiresAt ?? c.expiresAt,
      })),
    };
  },
});
export const clearDelivery = internalMutation({
  args: { id: v.id("probeRequests") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const r = await ctx.db.get("probeRequests", id);
    if (r?.cleanupAt && r.cleanupAt <= Date.now())
      await ctx.db.patch("probeRequests", id, {
        deliveryCipher: undefined,
        cleanupAt: undefined,
      });
    return null;
  },
});
export const clearLegacyCipher = internalMutation({
  args: { id: v.id("probeCredentials") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const c = await ctx.db.get("probeCredentials", id);
    if (c && c.expiresAt <= Date.now())
      await ctx.db.patch("probeCredentials", id, { cipher: undefined });
    return null;
  },
});
export const beginNotification = internalMutation({
  args: { id: v.id("probeNotifications") },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    const job = await ctx.db.get("probeNotifications", id);
    if (!job || job.status !== "pending" || (job.leaseUntil ?? 0) > Date.now())
      return null;
    const request = await ctx.db.get("probeRequests", job.requestId);
    const subscription = await ctx.db.get("probePush", job.subscriptionId);
    const account = request
      ? await ctx.db.get("probeAccounts", request.accountId)
      : null;
    if (
      !request ||
      request.status !== "pending" ||
      request.expiresAt <= Date.now() ||
      !subscription ||
      subscription.userId !== request.userId ||
      !account ||
      account.revoked
    ) {
      await ctx.db.patch("probeNotifications", id, { status: "cancelled" });
      return null;
    }
    if (job.attempts >= 5) {
      await ctx.db.patch("probeNotifications", id, { status: "failed" });
      return null;
    }
    const lease = randomSecret("push_");
    await ctx.db.patch("probeNotifications", id, {
      lease,
      leaseUntil: Date.now() + 30_000,
      attempts: job.attempts + 1,
    });
    // A crashed action cannot strand a pending job.
    await ctx.scheduler.runAfter(31_000, internal.probeNotifications.deliver, {
      id,
    });
    return { lease, subscription, requestId: request._id };
  },
});
export const finishNotification = internalMutation({
  args: {
    id: v.id("probeNotifications"),
    lease: v.string(),
    outcome: v.union(v.literal("sent"), v.literal("retry"), v.literal("gone")),
  },
  returns: v.null(),
  handler: async (ctx, { id, lease, outcome }) => {
    const job = await ctx.db.get("probeNotifications", id);
    if (!job || job.status !== "pending" || job.lease !== lease) return null;
    if (outcome === "gone") {
      const subscription = await ctx.db.get("probePush", job.subscriptionId);
      if (subscription) await ctx.db.delete("probePush", subscription._id);
    }
    const terminal =
      outcome === "sent"
        ? "sent"
        : outcome === "gone" || job.attempts >= 5
          ? "failed"
          : "pending";
    const nextAt = Date.now() + Math.min(120_000, 5000 * 2 ** job.attempts);
    await ctx.db.patch("probeNotifications", id, {
      status: terminal,
      lease: undefined,
      leaseUntil: terminal === "pending" ? nextAt : undefined,
    });
    if (terminal === "pending")
      await ctx.scheduler.runAt(nextAt, internal.probeNotifications.deliver, {
        id,
      });
    return null;
  },
});

export const accountsForOwner = query({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    const userId = await owner(ctx);
    return ctx.db
      .query("probeAccounts")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(100)
      .then((rows) => rows.filter((r) => !!r.providerUserId));
  },
});
export const requestsForOwner = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: v.any(),
  handler: async (ctx, { paginationOpts }) => {
    const userId = await owner(ctx);
    const rows = await ctx.db
      .query("probeRequests")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .paginate(paginationOpts);
    return {
      ...rows,
      page: await Promise.all(
        rows.page.map((r) => ownerRequestPresentation(ctx, r)),
      ),
    };
  },
});
export const credentialsForOwner = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: v.any(),
  handler: async (ctx, { paginationOpts }) => {
    const userId = await owner(ctx);
    const rows = await ctx.db
      .query("probeCredentials")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .paginate(paginationOpts);
    return {
      ...rows,
      page: rows.page.map((c) => ({
        id: c._id,
        accountId: c.accountId,
        expiresAt: c.expiresAt,
      })),
    };
  },
});

// A notification URL is an untrusted string, so normalize before reading it.
const ownerRequestView = v.object({
  createdAt: v.number(),
  requesterName: v.string(),
  requesterSource: v.string(),
  requesterStopped: v.optional(v.boolean()),
  requesterStoppedAt: v.optional(v.number()),
  intent: v.optional(v.string()),
  stoppedAt: v.optional(v.number()),
  deliveryExpiresAt: v.optional(v.number()),
  _id: v.id("probeRequests"),
  accountId: v.id("probeAccounts"),
  reason: v.string(),
  requester: v.string(),
  status: v.union(
    v.literal("pending"),
    v.literal("approved"),
    v.literal("denied"),
    v.literal("cancelled"),
  ),
  expiresAt: v.number(),
  decidedAt: v.optional(v.number()),
  deliveredAt: v.optional(v.number()),
  receivedAt: v.optional(v.number()),
});
export const requestForOwner = query({
  args: { reference: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      request: ownerRequestView,
      account: v.union(
        v.null(),
        v.object({
          _id: v.id("probeAccounts"),
          label: v.string(),
          providerEmail: v.optional(v.string()),
          baseName: v.optional(v.string()),
          revoked: v.boolean(),
          blockedAt: v.optional(v.number()),
          providerUserId: v.optional(v.string()),
          credentialKind: v.optional(v.literal("shared-pat")),
          baseId: v.optional(v.string()),
        }),
      ),
    }),
  ),
  handler: async (ctx, { reference }) => {
    const userId = await owner(ctx);
    const id = ctx.db.normalizeId("probeRequests", reference);
    if (!id) return null;
    const r = await ctx.db.get("probeRequests", id);
    if (!r || r.userId !== userId) return null;
    const a = await ctx.db.get("probeAccounts", r.accountId);
    return {
      request: await ownerRequestPresentation(ctx, r),
      account:
        a?.userId === userId
          ? {
              _id: a._id,
              label: a.label,
              providerEmail: a.providerEmail,
              baseName: a.baseName,
              revoked: a.revoked,
              blockedAt: a.blockedAt,
              providerUserId: a.providerUserId,
              credentialKind: a.credentialKind,
              baseId: a.baseId,
            }
          : null,
    };
  },
});

async function ownerRequestPresentation(
  ctx: QueryCtx,
  r: Doc<"probeRequests">,
) {
  let requesterName = "MCP connection";
  const legacy = r.requester.startsWith("scope-agent:");
  let requesterStopped = legacy;
  const connection = await ctx.db
    .query("probeRequesters")
    .withIndex("by_requester", (q) => q.eq("requester", r.requester))
    .unique();
  if (connection?.userId === r.userId) {
    requesterName = connection.name;
    requesterStopped = legacy || connection.stoppedAt !== undefined;
  }
  return {
    _id: r._id,
    accountId: r.accountId,
    reason: r.reason,
    requester: r.requester,
    requesterName,
    requesterStopped,
    requesterStoppedAt:
      connection?.userId === r.userId ? connection.stoppedAt : undefined,
    requesterSource: legacy
      ? "Retired Scope connection"
      : "Authorized MCP connection",
    intent: r.intent,
    createdAt: r._creationTime,
    status: r.status,
    expiresAt: r.expiresAt,
    deliveryExpiresAt: r.deliveryExpiresAt,
    decidedAt: r.decidedAt,
    deliveredAt: r.deliveredAt,
    receivedAt: r.receivedAt,
    stoppedAt: r.stoppedAt,
  };
}

// Pending decisions are queried independently of paginated history, so an older
// live request cannot be hidden behind a page of recent completed requests.
export const pendingForOwner = query({
  args: { now: v.number() },
  returns: v.array(ownerRequestView),
  handler: async (ctx, { now }) => {
    const userId = await owner(ctx);
    const rows = await ctx.db
      .query("probeRequests")
      .withIndex("by_user_status_deadline", (q) =>
        q.eq("userId", userId).eq("status", "pending").gt("expiresAt", now),
      )
      .take(50);
    return Promise.all(rows.map((r) => ownerRequestPresentation(ctx, r)));
  },
});

// Decisions made beyond the history page remain live in the mounted inbox.
export const retainedForOwner = query({
  args: { ids: v.array(v.id("probeRequests")) },
  returns: v.array(ownerRequestView),
  handler: async (ctx, { ids }) => {
    const userId = await owner(ctx);
    if (ids.length > 100) throw new Error("Too many requests");
    const rows = await Promise.all(
      ids.map((id) => ctx.db.get("probeRequests", id)),
    );
    return Promise.all(
      rows
        .filter((r): r is Doc<"probeRequests"> => !!r && r.userId === userId)
        .map((r) => ownerRequestPresentation(ctx, r)),
    );
  },
});

export const beginConnection = mutation({
  args: {
    secret: v.string(),
    connectorId: v.string(),
    issuer: v.string(),
    proofHash: v.string(),
  },
  returns: v.id("probeConnectionAttempts"),
  handler: async (ctx, args) => {
    service(args.secret);
    const userId = await owner(ctx);
    if (
      !args.connectorId ||
      !args.issuer.startsWith("https://") ||
      !/^[a-f0-9]{64}$/.test(args.proofHash)
    )
      throw new Error("Invalid connection");
    const expiresAt = Date.now() + 600_000;
    const id = await ctx.db.insert("probeConnectionAttempts", {
      userId,
      connectorId: args.connectorId,
      issuer: args.issuer,
      proofHash: args.proofHash,
      subjectId: `scope:probe:${userId}:${randomSecret("", 16)}`,
      expiresAt,
    });
    await ctx.scheduler.runAt(
      expiresAt,
      internal.probe.clearConnectionAttempt,
      { id },
    );
    return id;
  },
});
export const connectionAttempt = query({
  args: { id: v.id("probeConnectionAttempts") },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    const userId = await owner(ctx);
    const row = await ctx.db.get("probeConnectionAttempts", id);
    if (!row || row.userId !== userId)
      throw new Error("Connection unavailable");
    return row;
  },
});
export const completeConnection = mutation({
  args: {
    secret: v.string(),
    id: v.id("probeConnectionAttempts"),
    proofHash: v.string(),
    providerUserId: v.string(),
    providerEmail: v.optional(v.string()),
    installationId: v.string(),
  },
  returns: v.id("probeAccounts"),
  handler: async (ctx, args) => {
    service(args.secret);
    const userId = await owner(ctx);
    const row = await ctx.db.get("probeConnectionAttempts", args.id);
    if (
      !row ||
      row.userId !== userId ||
      row.expiresAt <= Date.now() ||
      row.proofHash !== args.proofHash ||
      !args.providerUserId ||
      !args.installationId ||
      args.installationId === "*"
    )
      throw new Error("Connection unavailable");
    if (row.accountId) {
      const existing = await ctx.db.get("probeAccounts", row.accountId);
      if (
        !existing ||
        existing.userId !== userId ||
        existing.revoked ||
        existing.providerUserId !== args.providerUserId ||
        existing.installationId !== args.installationId
      )
        throw new Error("Account identity changed");
      return existing._id;
    }
    const id = await ctx.db.insert("probeAccounts", {
      userId,
      connectorId: row.connectorId,
      subjectId: row.subjectId,
      issuer: row.issuer,
      label: args.providerEmail || "Airtable account",
      providerUserId: args.providerUserId,
      providerEmail: args.providerEmail,
      installationId: args.installationId,
      revoked: false,
    });
    await ctx.db.patch("probeConnectionAttempts", row._id, { accountId: id });
    return id;
  },
});
export const saveVerifiedPat = mutation({
  args: {
    secret: v.string(),
    connectorId: v.string(),
    issuer: v.string(),
    baseId: v.string(),
    label: v.string(),
    providerUserId: v.string(),
    providerEmail: v.optional(v.string()),
    baseName: v.optional(v.string()),
  },
  returns: v.id("probeAccounts"),
  handler: async (ctx, args) => {
    service(args.secret);
    const userId = await owner(ctx);
    if (!args.providerUserId || !args.baseId)
      throw new Error("Account unavailable");
    const rows = await ctx.db
      .query("probeAccounts")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(100);
    const existing = rows.find(
      (r) =>
        !r.revoked &&
        r.credentialKind === "shared-pat" &&
        r.connectorId === args.connectorId &&
        r.baseId === args.baseId,
    );
    const { secret: _secret, ...metadata } = args;
    void _secret;
    if (existing) {
      if (
        existing.providerUserId &&
        existing.providerUserId !== args.providerUserId
      )
        throw new Error("Account identity changed");
      await ctx.db.patch("probeAccounts", existing._id, metadata);
      return existing._id;
    }
    return ctx.db.insert("probeAccounts", {
      ...metadata,
      userId,
      credentialKind: "shared-pat",
      subjectId: `scope:probe:${userId}:${randomSecret("", 16)}`,
      revoked: false,
    });
  },
});
export const clearConnectionAttempt = internalMutation({
  args: { id: v.id("probeConnectionAttempts") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get("probeConnectionAttempts", id);
    if (row && row.expiresAt <= Date.now())
      await ctx.db.delete("probeConnectionAttempts", id);
    return null;
  },
});

export const deviceSubscribed = query({
  args: { endpoint: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { endpoint }) => {
    const userId = await owner(ctx);
    const rows = await ctx.db
      .query("probePush")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(10);
    return rows.some((row) => row.endpoint === endpoint);
  },
});

export const mcpConnections = query({
  args: {},
  returns: v.array(
    v.object({ requester: v.string(), name: v.string(), stopped: v.boolean() }),
  ),
  handler: async (ctx) => {
    const userId = await owner(ctx);
    const saved = await ctx.db
      .query("probeRequesters")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(100);
    const recent = await ctx.db
      .query("probeRequests")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(100);
    const rows = new Map(
      saved
        .filter((r) => !r.requester.startsWith("scope-agent:"))
        .map((r) => [
          r.requester,
          {
            requester: r.requester,
            name: r.name,
            stopped: r.stoppedAt !== undefined,
          },
        ]),
    );
    for (const r of recent)
      if (!r.requester.startsWith("scope-agent:") && !rows.has(r.requester))
        rows.set(r.requester, {
          requester: r.requester,
          name: "MCP connection",
          stopped: false,
        });
    return [...rows.values()];
  },
});
export const updateMcpConnection = mutation({
  args: {
    requester: v.string(),
    name: v.optional(v.string()),
    stop: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await owner(ctx);
    if (args.requester.startsWith("scope-agent:"))
      throw new Error("Connection unavailable");
    const existing = await ctx.db
      .query("probeRequesters")
      .withIndex("by_requester", (q) => q.eq("requester", args.requester))
      .unique();
    const proof =
      existing ??
      (await ctx.db
        .query("probeRequests")
        .withIndex("by_requester_key", (q) => q.eq("requester", args.requester))
        .first());
    if (!proof || proof.userId !== userId)
      throw new Error("Connection unavailable");
    const name = args.name?.trim();
    if (args.name !== undefined && (!name || name.length > 80))
      throw new Error("Invalid name");
    if (existing)
      await ctx.db.patch("probeRequesters", existing._id, {
        name: name ?? existing.name,
        stoppedAt: args.stop
          ? (existing.stoppedAt ?? Date.now())
          : existing.stoppedAt,
      });
    else
      await ctx.db.insert("probeRequesters", {
        userId,
        requester: args.requester,
        name: name ?? "MCP connection",
        stoppedAt: args.stop ? Date.now() : undefined,
      });
    return null;
  },
});
