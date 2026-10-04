"use node";
import webpush from "web-push";
import { v } from "convex/values";
import { action, internalAction, env } from "./_generated/server";
import { validatePushEndpoint } from "./lib/push";
import { internal } from "./_generated/api";
import { owner } from "./scope";

export const deliver = internalAction({
  args: {
    requestId: v.id("approvalRequests"),
    subscriptionId: v.id("pushSubscriptions"),
  },
  returns: v.null(),
  handler: async (ctx, { requestId, subscriptionId }) => {
    const sub = await ctx.runQuery(
      internal.notifications.deliverySubscription,
      {
        requestId,
        subscriptionId,
        now: Date.now(),
      },
    );
    if (!sub) return null;
    try {
      const publicKey = env.SCOPE_VAPID_PUBLIC_KEY,
        privateKey = env.SCOPE_VAPID_PRIVATE_KEY;
      if (!publicKey || !privateKey) throw new Error("Push unavailable");
      validatePushEndpoint(sub.endpoint);
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        JSON.stringify({ requestId }),
        {
          vapidDetails: {
            subject: "mailto:scope@example.com",
            publicKey,
            privateKey,
          },
          TTL: 300,
          timeout: 5000,
        },
      );
    } catch (error) {
      const status = (error as { statusCode?: number })?.statusCode;
      if (status === 404 || status === 410)
        await ctx.runMutation(internal.notifications.removeGoneSubscription, {
          ownerId: sub.ownerId,
          endpoint: sub.endpoint,
        });
      // The retrier persists errors. Never pass provider exceptions or subscription keys to it.
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
    const publicKey = env.SCOPE_VAPID_PUBLIC_KEY,
      privateKey = env.SCOPE_VAPID_PRIVATE_KEY;
    if (!publicKey || !privateKey)
      return { sent: 0, failed: 0, configured: false };
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
        {
          vapidDetails: {
            subject: "mailto:scope@example.com",
            publicKey,
            privateKey,
          },
          TTL: 300,
          timeout: 5000,
        },
      );
      return { sent: 1, failed: 0, configured: true };
    } catch (error) {
      const status = (error as { statusCode?: number })?.statusCode;
      if (status === 404 || status === 410)
        await ctx.runMutation(internal.notifications.removeGoneSubscription, {
          ownerId,
          endpoint,
        });
      // Transport exceptions can contain subscription secrets. Return only counts.
      return { sent: 0, failed: 1, configured: true };
    }
  },
});
