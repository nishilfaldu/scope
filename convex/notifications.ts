import { v } from "convex/values";
import {
  query,
  mutation,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { owner, collectorEligible } from "./scope";
import { validatePushEndpoint } from "./lib/push";
import { randomSecret } from "./lib/secrets";
const subscription = v.object({
  endpoint: v.string(),
  p256dh: v.string(),
  auth: v.string(),
});
export const subscribe = mutation({
  args: subscription.fields,
  returns: v.null(),
  handler: async (ctx, args) => {
    const ownerId = await owner(ctx);
    validatePushEndpoint(args.endpoint);
    if (
      args.endpoint.length > 2048 ||
      !args.p256dh ||
      !args.auth ||
      args.p256dh.length > 256 ||
      args.auth.length > 256
    )
      throw new Error("Invalid subscription");
    const rows = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", ownerId))
      .take(10);
    const old = rows.find((r) => r.endpoint === args.endpoint);
    if (old) await ctx.db.patch("pushSubscriptions", old._id, args);
    else {
      if (rows.length >= 10) throw new Error("Subscription limit");
      await ctx.db.insert("pushSubscriptions", { ownerId, ...args });
    }
    return null;
  },
});
export const unsubscribe = mutation({
  args: { endpoint: v.string() },
  returns: v.null(),
  handler: async (ctx, { endpoint }) => {
    const ownerId = await owner(ctx),
      rows = await ctx.db
        .query("pushSubscriptions")
        .withIndex("by_ownerId", (q) => q.eq("ownerId", ownerId))
        .take(10);
    for (const r of rows)
      if (r.endpoint === endpoint)
        await ctx.db.delete("pushSubscriptions", r._id);
    return null;
  },
});
export const pushStatus = query({
  args: { endpoint: v.string() },
  returns: v.object({ subscribed: v.boolean() }),
  handler: async (ctx, { endpoint }) => {
    const ownerId = await owner(ctx),
      rows = await ctx.db
        .query("pushSubscriptions")
        .withIndex("by_ownerId", (q) => q.eq("ownerId", ownerId))
        .take(10);
    return { subscribed: rows.some((r) => r.endpoint === endpoint) };
  },
});
export const beginDelivery = internalMutation({
  args: { id: v.id("notificationJobs") },
  returns: v.union(
    v.null(),
    v.object({
      lease: v.string(),
      subscription,
      requestId: v.id("approvalRequests"),
    }),
  ),
  handler: async (ctx, { id }) => {
    const job = await ctx.db.get("notificationJobs", id);
    if (!job || job.status !== "pending" || (job.leaseUntil ?? 0) > Date.now())
      return null;
    const [request, sub] = await Promise.all([
      ctx.db.get("approvalRequests", job.requestId),
      ctx.db.get("pushSubscriptions", job.subscriptionId),
    ]);
    const account = request
      ? await ctx.db.get("connectedAccounts", request.accountId)
      : null;
    const requester = request
      ? await ctx.db.get("clientConnections", request.requesterConnectionId)
      : null;
    const collector = request
      ? await ctx.db.get("clientConnections", request.collectorConnectionId)
      : null;
    if (
      !request ||
      request.status !== "pending" ||
      request.approvalExpiresAt <= Date.now() ||
      !sub ||
      sub.ownerId !== request.ownerId ||
      !account ||
      account.ownerId !== request.ownerId ||
      account.state !== "active" ||
      account.grantVersion !== request.grantVersion ||
      account.profileId !== request.profileId ||
      account.profileVersion !== request.profileVersion ||
      !requester ||
      requester.ownerId !== request.ownerId ||
      requester.stoppedAt !== undefined ||
      !collector ||
      collector.ownerId !== request.ownerId ||
      collector.stoppedAt !== undefined ||
      !collectorEligible(collector.clientId)
    ) {
      await ctx.db.patch("notificationJobs", id, { status: "cancelled" });
      return null;
    }
    if (job.attempts >= 5) {
      await ctx.db.patch("notificationJobs", id, { status: "failed" });
      return null;
    }
    const lease = randomSecret("push_");
    await ctx.db.patch("notificationJobs", id, {
      lease,
      leaseUntil: Date.now() + 30_000,
      attempts: job.attempts + 1,
    });
    await ctx.scheduler.runAfter(
      31_000,
      internal.notificationDelivery.deliver,
      { id },
    );
    return {
      lease,
      subscription: {
        endpoint: sub.endpoint,
        p256dh: sub.p256dh,
        auth: sub.auth,
      },
      requestId: request._id,
    };
  },
});
export const finishDelivery = internalMutation({
  args: {
    id: v.id("notificationJobs"),
    lease: v.string(),
    outcome: v.union(v.literal("sent"), v.literal("retry"), v.literal("gone")),
  },
  returns: v.null(),
  handler: async (ctx, { id, lease, outcome }) => {
    const job = await ctx.db.get("notificationJobs", id);
    if (!job || job.status !== "pending" || job.lease !== lease) return null;
    if (
      outcome === "gone" &&
      (await ctx.db.get("pushSubscriptions", job.subscriptionId))
    )
      await ctx.db.delete("pushSubscriptions", job.subscriptionId);
    const terminal =
      outcome === "sent"
        ? "sent"
        : outcome === "gone" || job.attempts >= 5
          ? "failed"
          : "pending";
    const nextAt = Date.now() + Math.min(120_000, 5000 * 2 ** job.attempts);
    await ctx.db.patch("notificationJobs", id, {
      status: terminal,
      lease: undefined,
      leaseUntil: terminal === "pending" ? nextAt : undefined,
    });
    if (terminal === "pending")
      await ctx.scheduler.runAt(nextAt, internal.notificationDelivery.deliver, {
        id,
      });
    return null;
  },
});

// Subscription keys stay within the backend action boundary.
export const testSubscription = internalQuery({
  args: { ownerId: v.id("users"), endpoint: v.string() },
  returns: v.union(v.null(), subscription),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", args.ownerId))
      .take(10);
    const row = rows.find((r) => r.endpoint === args.endpoint);
    return row
      ? { endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth }
      : null;
  },
});
export const removeGoneSubscription = internalMutation({
  args: { ownerId: v.id("users"), endpoint: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", args.ownerId))
      .take(10);
    for (const row of rows)
      if (row.endpoint === args.endpoint)
        await ctx.db.delete("pushSubscriptions", row._id);
    return null;
  },
});
