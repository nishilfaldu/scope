import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { providerName } from "../shared/connectors";
import { permissionSummary } from "../shared/permissions";
import { toolFor } from "../shared/tools";
import { onlyAccount, requesterName } from "./approvals";
import { validatePushEndpoint } from "./lib/push";
import { ownerId as owner } from "./lib/identity";

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
    const old = rows.find((row) => row.endpoint === args.endpoint);
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
    const ownerId = await owner(ctx);
    const rows = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", ownerId))
      .take(10);
    for (const row of rows)
      if (row.endpoint === endpoint)
        await ctx.db.delete("pushSubscriptions", row._id);
    return null;
  },
});

export const pushStatus = query({
  args: { endpoint: v.string() },
  returns: v.object({ subscribed: v.boolean() }),
  handler: async (ctx, { endpoint }) => {
    const ownerId = await owner(ctx);
    const rows = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", ownerId))
      .take(10);
    return { subscribed: rows.some((row) => row.endpoint === endpoint) };
  },
});

// Reload the approval and subscription immediately before every send.
export const deliverySubscription = internalQuery({
  args: {
    approvalId: v.id("approvals"),
    subscriptionId: v.id("pushSubscriptions"),
  },
  returns: v.union(
    v.null(),
    subscription.extend({
      ownerId: v.string(),
      expiresAt: v.number(),
      message: v.object({
        title: v.string(),
        body: v.string(),
        quickApprove: v.boolean(),
        approveLabel: v.string(),
        approveMinutes: v.union(v.literal(0), v.literal(30)),
      }),
    }),
  ),
  handler: async (ctx, { approvalId, subscriptionId }) => {
    const [approval, sub] = await Promise.all([
      ctx.db.get("approvals", approvalId),
      ctx.db.get("pushSubscriptions", subscriptionId),
    ]);
    if (
      !approval ||
      approval.status !== "pending" ||
      !sub ||
      sub.ownerId !== approval.ownerId
    )
      return null;
    const [name, account] = await Promise.all([
      requesterName(ctx, approval),
      onlyAccount(ctx, approval.ownerId, approval.providerId),
    ]);
    const reason =
      approval.reason.length > 180
        ? `${approval.reason.slice(0, 179)}…`
        : approval.reason;
    const tool = approval.tool ? toolFor(approval.tool) : undefined;
    const provider = providerName(approval.providerId);
    return {
      ownerId: sub.ownerId,
      endpoint: sub.endpoint,
      p256dh: sub.p256dh,
      auth: sub.auth,
      expiresAt: approval.expiresAt,
      message: {
        title: tool
          ? `${name} wants ${provider}: ${tool.title}`
          : `${name} wants ${provider}`,
        body: account
          ? [
              reason,
              account.label,
              // An app request runs one tool, so the token's full scope list does not apply.
              !tool &&
                account.permissions?.scopes.length &&
                permissionSummary(
                  approval.providerId,
                  account.permissions.scopes,
                ),
            ]
              .filter(Boolean)
              .join("\n")
          : reason,
        quickApprove: !!account,
        approveLabel: tool ? "Approve once" : "Approve 30 min",
        approveMinutes: tool ? (0 as const) : (30 as const),
      },
    };
  },
});

export const testSubscription = internalQuery({
  args: { ownerId: v.string(), endpoint: v.string() },
  returns: v.union(v.null(), subscription),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", args.ownerId))
      .take(10);
    const row = rows.find((item) => item.endpoint === args.endpoint);
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
