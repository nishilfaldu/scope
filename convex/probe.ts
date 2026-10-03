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
import {
  activeAgentConnection,
  activeConnectionForAgent,
} from "./tables/agentConnections";

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
  if (args.requester.startsWith("scope-agent:")) {
    const [, agentId, connectionId, extra] = args.requester.split(":");
    const connection = agentId
      ? await activeConnectionForAgent(ctx, agentId)
      : null;
    if (
      extra ||
      !connection ||
      connection._id !== connectionId ||
      connection.userId !== args.userId
    )
      throw new Error("Unauthorized");
  }
}

export const existingAgent = query({
  args: {
    secret: v.string(),
    connectionId: v.string(),
    connectionSecret: v.string(),
  },
  returns: v.object({ userId: v.id("users"), requester: v.string() }),
  handler: async (ctx, args) => {
    service(args.secret);
    const connection = await activeAgentConnection(
      ctx,
      args.connectionId,
      args.connectionSecret,
    );
    if (!connection) throw new Error("Unauthorized");
    return {
      userId: connection.userId,
      requester: `scope-agent:${connection.agentId}:${connection._id}`,
    };
  },
});

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
export const addAccount = mutation({
  args: {
    secret: v.string(),
    label: v.string(),
    connectorId: v.string(),
    issuer: v.string(),
    credentialKind: v.optional(v.literal("shared-pat")),
    baseId: v.optional(v.string()),
  },
  returns: v.id("probeAccounts"),
  handler: async (ctx, args) => {
    service(args.secret);
    const userId = await owner(ctx);
    if (
      !args.label.trim() ||
      args.label.length > 100 ||
      !args.connectorId ||
      !args.issuer.startsWith("https://")
    )
      throw new Error("Invalid account");
    const { secret: _secret, ...binding } = args;
    void _secret;
    return ctx.db.insert("probeAccounts", {
      ...binding,
      userId,
      subjectId: `scope:probe:${userId}:${randomSecret("", 16)}`,
      revoked: false,
    });
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
export const confirmAccount = mutation({
  args: {
    secret: v.string(),
    id: v.id("probeAccounts"),
    installationId: v.optional(v.string()),
    providerUserId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    service(args.secret);
    const userId = await owner(ctx);
    const row = await ctx.db.get("probeAccounts", args.id);
    if (!row || row.userId !== userId || row.revoked)
      throw new Error("Account unavailable");
    if (
      (row.providerUserId && row.providerUserId !== args.providerUserId) ||
      (row.installationId && row.installationId !== args.installationId)
    )
      throw new Error("Account identity changed");
    await ctx.db.patch("probeAccounts", args.id, {
      installationId: args.installationId,
      providerUserId: args.providerUserId,
    });
    return null;
  },
});
export const revokeAccount = mutation({
  args: { id: v.id("probeAccounts") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const userId = await owner(ctx);
    const row = await ctx.db.get("probeAccounts", id);
    if (!row || row.userId !== userId) throw new Error("Account unavailable");
    await ctx.db.patch("probeAccounts", id, { revoked: true });
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
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await authorizeActor(ctx, args);
    if (
      !/^[\w-]{16,128}$/.test(args.key) ||
      !args.reason.trim() ||
      args.reason.length > 1000
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
        old.reason !== args.reason
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
      .withIndex("by_user_status", (q) =>
        q.eq("userId", args.userId).eq("status", "pending"),
      )
      .order("desc")
      .take(100);
    if (pending.filter((r) => r.expiresAt > Date.now()).length >= 50)
      throw new Error("Pending request limit");
    const expiresAt = Date.now() + 30 * 60_000;
    const id = await ctx.db.insert("probeRequests", {
      userId: args.userId,
      requester: args.requester,
      key: args.key,
      accountId: args.accountId,
      reason: args.reason,
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
      .take(100);
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
      page: rows.page.map((r) => ({
        _id: r._id,
        accountId: r.accountId,
        reason: r.reason,
        requester: r.requester,
        status: r.status,
        expiresAt: r.expiresAt,
        decidedAt: r.decidedAt,
        deliveredAt: r.deliveredAt,
        receivedAt: r.receivedAt,
      })),
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
          revoked: v.boolean(),
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
      request: {
        _id: r._id,
        accountId: r.accountId,
        reason: r.reason,
        requester: r.requester,
        status: r.status,
        expiresAt: r.expiresAt,
        decidedAt: r.decidedAt,
        deliveredAt: r.deliveredAt,
        receivedAt: r.receivedAt,
      },
      account:
        a?.userId === userId
          ? {
              _id: a._id,
              label: a.label,
              revoked: a.revoked,
              providerUserId: a.providerUserId,
              credentialKind: a.credentialKind,
              baseId: a.baseId,
            }
          : null,
    };
  },
});
