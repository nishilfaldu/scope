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
import styles from "@/components/scope/scope.module.css";
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
  return (
    <>
      <header className={styles.pageHeading}>
        <h1>Notifications</h1>
      </header>
      <section className={styles.notificationSetup}>
        <div className={styles.phoneIllustration} aria-hidden>
          <div>
            <BrandMark className="size-6" />
            <span>
              Scope<strong>An agent needs your approval</strong>
            </span>
          </div>
        </div>
        {support === "denied" && (
          <p>Allow Scope notifications in your device settings.</p>
        )}
        {support === "unsupported" && (
          <p>Use a browser that supports notifications.</p>
        )}
        {support === "install" && (
          <p>Add Scope to your Home Screen to enable notifications.</p>
        )}
        {support === "install" && (
          <ol className={styles.installSteps}>
            <li>
              <span>1</span>Open Scope in Safari.
            </li>
            <li>
              <span>2</span>Tap Share, then Add to Home Screen.
            </li>
            <li>
              <span>3</span>Open Scope from your Home Screen and sign in.
            </li>
            <li>
              <span>4</span>Return here to enable notifications.
            </li>
          </ol>
        )}
        <div className={styles.actions}>
          {(support === "checking" ||
            (support === "granted" && !!endpoint && saved === undefined)) && (
            <Skeleton className="h-9 w-40 rounded-lg" />
          )}
          {enabled && (
            <span className={styles.enabledStatus}>Notifications enabled</span>
          )}
          {canEnable &&
            !enabled &&
            !(support === "granted" && !!endpoint && saved === undefined) && (
              <Button
                className={styles.approve}
                disabled={!!busy}
                onClick={() => void enable()}
              >
                {busy === "enable" && (
                  <span className={styles.spinner} aria-hidden />
                )}
                Enable notifications
              </Button>
            )}
          {enabled && (
            <Button
              variant="ghost"
              className={styles.actionButton}
              disabled={!!busy}
              onClick={() => void test()}
            >
              {busy === "test" && (
                <span className={styles.spinner} aria-hidden />
              )}
              Send test
            </Button>
          )}
        </div>
      </section>
    </>
  );
}
