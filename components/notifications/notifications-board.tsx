"use client";
import { useEffect, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { BrandMark } from "@/components/shared/brand-mark";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import {
  matchesApplicationKey,
  notificationSupport,
  enableBrowserNotifications,
  type NotificationSupport,
} from "@/lib/browser-notifications";
import { PageHeading, Spinner } from "@/components/shared/page-parts";
export function NotificationsBoard() {
  const sendTest = useAction(api.notificationDelivery.test);
  const subscribe = useMutation(api.notifications.subscribe);
  const unsubscribe = useMutation(api.notifications.unsubscribe);
  const [support, setSupport] = useState<NotificationSupport>("checking"),
    [endpoint, setEndpoint] = useState("");
  const saved = useQuery(
    api.notifications.pushStatus,
    endpoint ? { endpoint } : "skip",
  );
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    async function refresh() {
      const next = notificationSupport();
      if (next !== "granted") {
        if (active) {
          setSupport(next);
          setEndpoint("");
        }
        return;
      }
      try {
        const registrations = await navigator.serviceWorker.getRegistrations();
        const registration = registrations.find((r) =>
          [r.active, r.waiting, r.installing].some(
            (w) => w && new URL(w.scriptURL).pathname === "/scope-sw.js",
          ),
        );
        const subscription = await registration?.pushManager.getSubscription();
        if (active)
          setEndpoint(
            subscription &&
              matchesApplicationKey(
                subscription,
                process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "",
              )
              ? subscription.endpoint
              : "",
          );
      } catch {
        if (active) setEndpoint("");
      } finally {
        if (active) setSupport(next);
      }
    }
    void refresh();
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      window.removeEventListener("focus", refresh);
    };
  }, []);
  async function enable() {
    setBusy("enable");
    try {
      const data = await enableBrowserNotifications(
        process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "",
      );
      const { replacedEndpoint, ...subscription } = data;
      if (replacedEndpoint) await unsubscribe({ endpoint: replacedEndpoint });
      await subscribe(subscription);
      setEndpoint(data.endpoint);
      toast.add({ title: "Notifications enabled.", type: "success" });
    } catch (e) {
      toast.add({
        title:
          e instanceof Error
            ? e.message
            : "Could not save notification setup. Check your sign-in and try again.",
        type: "error",
        priority: "high",
      });
    } finally {
      setSupport(notificationSupport());
      setBusy(null);
    }
  }
  async function test() {
    setBusy("test");
    try {
      const result = await sendTest({ endpoint });
      toast.add({
        title: !result.configured
          ? "Notifications are not configured for this Scope environment."
          : result.sent
            ? "Test sent. Check your device."
            : "No test was sent. Enable notifications on a device and try again.",
        type: result.sent ? "success" : "error",
        priority: result.sent ? "low" : "high",
      });
    } catch {
      toast.add({
        title: "Could not send a test. Check your sign-in and try again.",
        type: "error",
        priority: "high",
      });
    } finally {
      setBusy(null);
    }
  }
  const enabled = support === "granted" && saved?.subscribed === true,
    canEnable = ["default", "granted"].includes(support);
  const loading =
    support === "checking" ||
    (support === "granted" && !!endpoint && saved === undefined);
  return (
    <>
      <PageHeading title="Notifications">
        Get a notification on this device when an agent asks for a token.
      </PageHeading>
      <div className="space-y-5 rounded-2xl border border-scope-line bg-white p-6">
        <div
          aria-hidden
          className="flex max-w-sm items-center gap-3 rounded-2xl bg-scope-wash p-4"
        >
          <BrandMark className="size-6" />
          <span className="flex flex-col text-xs text-scope-quiet">
            Scope
            <strong className="text-sm font-medium text-scope-ink">
              An agent needs your approval
            </strong>
          </span>
        </div>
        {support === "denied" && (
          <p>Allow Scope notifications in your device settings.</p>
        )}
        {support === "unsupported" && (
          <p>Use a browser that supports notifications.</p>
        )}
        {support === "install" && (
          <ol className="list-decimal space-y-1 pl-5 leading-relaxed">
            <li>Open Scope in Safari.</li>
            <li>Tap Share, then Add to Home Screen.</li>
            <li>Open Scope from your Home Screen and sign in.</li>
            <li>Return here to enable notifications.</li>
          </ol>
        )}
        <div className="flex flex-wrap items-center gap-3">
          {loading && <Skeleton className="h-9 w-40 rounded-lg" />}
          {enabled && (
            <span className="text-scope-green">Notifications enabled</span>
          )}
          {canEnable && !enabled && !loading && (
            <Button
              className="rounded-lg bg-scope-green text-white hover:bg-scope-green-dark"
              disabled={!!busy}
              onClick={() => void enable()}
            >
              {busy === "enable" && <Spinner />}
              Enable notifications
            </Button>
          )}
          {enabled && (
            <Button
              variant="ghost"
              className="rounded-lg text-scope-green hover:bg-scope-hover"
              disabled={!!busy}
              onClick={() => void test()}
            >
              {busy === "test" && <Spinner />}
              Send test
            </Button>
          )}
        </div>
      </div>
    </>
  );
}
