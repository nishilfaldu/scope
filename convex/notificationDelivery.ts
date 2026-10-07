"use node";

import webpush from "web-push";
import { v } from "convex/values";
import { action, env, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { validatePushEndpoint } from "./lib/push";
import { ownerId as owner } from "./lib/identity";

function vapid() {
  const publicKey = env.SCOPE_VAPID_PUBLIC_KEY,
    privateKey = env.SCOPE_VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return;
  return {
    subject: "mailto:scope@example.com",
    publicKey,
    privateKey,
  };
}

export const deliver = internalAction({
  args: {
    approvalId: v.id("approvals"),
    subscriptionId: v.id("pushSubscriptions"),
  },
  returns: v.null(),
  handler: async (ctx, { approvalId, subscriptionId }) => {
    const sub = await ctx.runQuery(
      internal.notifications.deliverySubscription,
      {
        approvalId,
        subscriptionId,
      },
    );
    if (!sub) return null;
    const details = vapid();
    if (!details) return null;
    try {
      validatePushEndpoint(sub.endpoint);
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        JSON.stringify({ approvalId }),
        { vapidDetails: details, TTL: 300, timeout: 5000 },
      );
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410)
        await ctx.runMutation(internal.notifications.removeGoneSubscription, {
          ownerId: sub.ownerId,
          endpoint: sub.endpoint,
        });
      else throw new Error("Push delivery failed");
    }
    return null;
  },
});

export const test = action({
  args: { endpoint: v.string() },
  returns: v.object({
    sent: v.number(),
    failed: v.number(),
    configured: v.boolean(),
  }),
  handler: async (ctx, { endpoint }) => {
    const ownerId = await owner(ctx);
    validatePushEndpoint(endpoint);
    const details = vapid();
    if (!details) return { sent: 0, failed: 0, configured: false };
    const sub = await ctx.runQuery(internal.notifications.testSubscription, {
      ownerId,
      endpoint,
    });
    if (!sub) return { sent: 0, failed: 1, configured: true };
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        JSON.stringify({ test: true }),
        { vapidDetails: details, TTL: 300, timeout: 5000 },
      );
      return { sent: 1, failed: 0, configured: true };
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410)
        await ctx.runMutation(internal.notifications.removeGoneSubscription, {
          ownerId,
          endpoint,
        });
      return { sent: 0, failed: 1, configured: true };
    }
  },
});
