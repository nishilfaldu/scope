import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import {
  mutation,
  query,
  env,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server";
import { hashesEqual, randomSecret } from "./lib/secrets";

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

export const agentStatus = query({
  args: { ...agentArgs, id: v.id("probeRequests") },
  returns: v.object({
    status: v.string(),
    expiresAt: v.number(),
    revoked: v.boolean(),
  }),
  handler: async (ctx, args) => {
    service(args.secret);
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
  args: { label: v.string(), connectorId: v.string(), issuer: v.string() },
  returns: v.id("probeAccounts"),
  handler: async (ctx, args) => {
    const userId = await owner(ctx);
    if (
      !args.label.trim() ||
      args.label.length > 100 ||
      !args.connectorId ||
      !args.issuer.startsWith("https://")
    )
      throw new Error("Invalid account");
    return ctx.db.insert("probeAccounts", {
      ...args,
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
    id: v.id("probeAccounts"),
    installationId: v.string(),
    providerUserId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await owner(ctx);
    const row = await ctx.db.get("probeAccounts", args.id);
    if (!row || row.userId !== userId || row.revoked)
      throw new Error("Account unavailable");
    if (row.providerUserId && row.providerUserId !== args.providerUserId)
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
      requests: requests.map(({ lease: _lease, ...r }) => {
        void _lease;
        return r;
      }),
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
    if (!a || a.revoked || !a.providerUserId)
      throw new Error("Account unavailable");
    await ctx.db.patch("probeRequests", id, {
      status: approve ? "approved" : "denied",
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
    service(args.secret);
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
    return { id, status: "pending", expiresAt, created: true };
  },
});
export const claim = mutation({
  args: { ...agentArgs, id: v.id("probeRequests") },
  returns: v.any(),
  handler: async (ctx, args) => {
    service(args.secret);
    const r = await ctx.db.get("probeRequests", args.id);
    if (!r || r.userId !== args.userId || r.requester !== args.requester)
      throw new Error("Request unavailable");
    const a = await ctx.db.get("probeAccounts", r.accountId);
    if (!a || a.revoked) throw new Error("Account unavailable");
    if (r.expiresAt <= Date.now()) return { status: "expired" };
    if (r.status !== "approved") return { status: r.status };
    if (r.credentialId) {
      const c = await ctx.db.get("probeCredentials", r.credentialId);
      if (!c || c.expiresAt <= Date.now() + 30_000)
        return { status: "expired" };
      await ctx.db.patch("probeRequests", r._id, { deliveredAt: Date.now() });
      return {
        status: "ready",
        cipher: c.cipher,
        expiresAt: c.expiresAt,
        account: a,
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
    service(args.secret);
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
          cipher: args.cipher,
          expiresAt: args.expiresAt,
        });
    await ctx.db.patch("probeRequests", r._id, {
      credentialId,
      lease: undefined,
      leaseUntil: undefined,
    });
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
