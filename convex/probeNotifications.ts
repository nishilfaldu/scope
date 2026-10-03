"use node";
import webpush from "web-push";
import { v } from "convex/values";
import { internalAction, env } from "./_generated/server";
import { internal } from "./_generated/api";

export const deliver = internalAction({
  args: { id: v.id("probeNotifications") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const job = await ctx.runMutation(internal.probe.beginNotification, { id });
    if (!job) return null;
    let outcome: "sent" | "retry" | "gone" = "retry";
    try {
      const publicKey = env.SCOPE_VAPID_PUBLIC_KEY,
        privateKey = env.SCOPE_VAPID_PRIVATE_KEY;
      if (!publicKey || !privateKey) throw new Error("Push unavailable");
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
    await ctx.runMutation(internal.probe.finishNotification, {
      id,
      lease: job.lease,
      outcome,
    });
    return null;
  },
});
