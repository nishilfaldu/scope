"use node";
import { getAuthUserId } from "@convex-dev/auth/server";
import webpush from "web-push";
import { v } from "convex/values";
import { action, internalAction, env } from "./_generated/server";
import { validatePushEndpoint } from "./lib/push";
import { internal } from "./_generated/api";

export const deliver = internalAction({
  args: { id: v.id("notificationJobs") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const job = await ctx.runMutation(internal.notifications.beginDelivery, {
      id,
    });
    if (!job) return null;
    let outcome: "sent" | "retry" | "gone" = "retry";
    try {
      const publicKey = env.SCOPE_VAPID_PUBLIC_KEY,
        privateKey = env.SCOPE_VAPID_PRIVATE_KEY;
      if (!publicKey || !privateKey) throw new Error("Push unavailable");
      validatePushEndpoint(job.subscription.endpoint);
      await webpush.sendNotification(
        {
          endpoint: job.subscription.endpoint,
          keys: {
            p256dh: job.subscription.p256dh,
            auth: job.subscription.auth,
          },
        },
        JSON.stringify({ requestId: job.requestId }),
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
      outcome = "sent";
    } catch (error) {
      const status = (error as { statusCode?: number })?.statusCode;
      if (status === 404 || status === 410) outcome = "gone";
      // Provider errors can contain subscription secrets; never log them.
    }
    await ctx.runMutation(internal.notifications.finishDelivery, {
      id,
      lease: job.lease,
      outcome,
    });
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
    const ownerId = await getAuthUserId(ctx);
    if (!ownerId) throw new Error("Sign in required");
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
