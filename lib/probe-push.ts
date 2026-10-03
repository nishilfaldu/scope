import webpush from "web-push";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { config, db } from "./probe-server";
export async function notifyApproval(userId: Id<"users">) {
  if (!process.env.VAPID_PRIVATE_KEY)
    return { sent: 0, failed: 0, configured: false };
  const subscriptions = await db().query(api.probe.subscriptions, {
    secret: config("SCOPE_PROBE_SECRET"),
    userId,
  });
  const results = await Promise.allSettled(
    subscriptions.map((s: { endpoint: string; p256dh: string; auth: string }) =>
      webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({
          title: "Scope approval requested",
          url: "/approvals",
        }),
        {
          vapidDetails: {
            subject: "mailto:scope@example.com",
            publicKey: config("NEXT_PUBLIC_VAPID_PUBLIC_KEY"),
            privateKey: config("VAPID_PRIVATE_KEY"),
          },
          TTL: 300,
          timeout: 5000,
        },
      ),
    ),
  );
  return {
    configured: true,
    sent: results.filter((r) => r.status === "fulfilled").length,
    failed: results.filter((r) => r.status === "rejected").length,
  };
}
