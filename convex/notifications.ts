import { v } from "convex/values";
import {
  query,
  mutation,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { components } from "./_generated/api";
import { ActionRetrier } from "@convex-dev/action-retrier";
import { owner } from "./scope";
import { validatePushEndpoint } from "./lib/push";
export const retrier = new ActionRetrier(components.actionRetrier, {
  initialBackoffMs: 5000,
  maxFailures: 4,
  logLevel: "ERROR",
});
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
// Reload authority and subscription keys immediately before every send or retry.
// The retry component persists only the two IDs, never destination keys.
export const deliverySubscription = internalQuery({
  args: {
    requestId: v.id("accessApprovals"),
    subscriptionId: v.id("pushSubscriptions"),
    now: v.number(),
  },
  returns: v.union(v.null(), subscription.extend({ ownerId: v.string() })),
  handler: async (ctx, { requestId, subscriptionId, now }) => {
    const [request, sub] = await Promise.all([
      ctx.db.get("accessApprovals", requestId),
      ctx.db.get("pushSubscriptions", subscriptionId),
    ]);
    if (
      !request ||
      request.status !== "pending" ||
      request.waitingUntil <= now ||
      !sub ||
      sub.ownerId !== request.ownerId
    )
      return null;
    const account = await ctx.db.get("connectedAccounts", request.accountId);
    if (
      !account ||
      account.ownerId !== request.ownerId ||
      account.state !== "active" ||
      account.providerId !== request.providerId ||
      account.grantVersion !== request.grantVersion
    )
      return null;
    return {
      ownerId: sub.ownerId,
      endpoint: sub.endpoint,
      p256dh: sub.p256dh,
      auth: sub.auth,
    };
  },
});

// Subscription keys stay within the backend action boundary.
export const testSubscription = internalQuery({
  args: { ownerId: v.string(), endpoint: v.string() },
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
  args: { ownerId: v.string(), endpoint: v.string() },
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
