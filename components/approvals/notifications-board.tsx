"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { BoardShell } from "@/components/layout/board-shell";
import { BrandMark } from "@/components/shared/brand-mark";
import { Button } from "@/components/ui/button";
import { approvalPost } from "@/lib/approval-display";
import {
  notificationSupport,
  enableBrowserNotifications,
  type NotificationSupport,
} from "@/lib/browser-notifications";
import styles from "@/components/scope/scope.module.css";
export function NotificationsBoard() {
  const subscribe = useMutation(api.probe.subscribe);
  const [support, setSupport] = useState<NotificationSupport>("checking"),
    [endpoint, setEndpoint] = useState("");
  const saved = useQuery(
    api.probe.deviceSubscribed,
    endpoint ? { endpoint } : "skip",
  );
  const [busy, setBusy] = useState<string | null>(null),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    async function refresh() {
      const next = notificationSupport();
      if (active) setSupport(next);
      if (next !== "granted") {
        if (active) setEndpoint("");
        return;
      }
      try {
        const registrations = await navigator.serviceWorker.getRegistrations();
        const registration = registrations.find((r) =>
          [r.active, r.waiting, r.installing].some(
            (w) => w && new URL(w.scriptURL).pathname === "/probe-sw.js",
          ),
        );
        const subscription = await registration?.pushManager.getSubscription();
        if (active) setEndpoint(subscription?.endpoint ?? "");
      } catch {
        if (active) setEndpoint("");
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
    setError("");
    setMessage("");
    try {
      const data = await enableBrowserNotifications(
        process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "",
      );
      await subscribe(data);
      setEndpoint(data.endpoint);
      setMessage(
        "Notifications enabled on this device. Send a test to check receipt.",
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not save notification setup. Check your sign-in and try again.",
      );
    } finally {
      setSupport(notificationSupport());
      setBusy(null);
    }
  }
  async function test() {
    setBusy("test");
    setError("");
    setMessage("");
    try {
      const result = await approvalPost<{
        sent: number;
        failed: number;
        configured: boolean;
      }>("push-test", {});
      setMessage(
        !result.configured
          ? "Notifications are not configured for this Scope environment."
          : result.sent
            ? "Test sent to your subscribed devices. Check your device for receipt; sending does not confirm delivery."
            : "No test was sent. Enable notifications on a device and try again.",
      );
    } catch {
      setError("Could not send a test. Check your sign-in and try again.");
    } finally {
      setBusy(null);
    }
  }
  const enabled = support === "granted" && saved === true,
    canEnable = ["default", "granted"].includes(support);
  return (
    <BoardShell title="Notifications">
      <header className={styles.pageHeading}>
        <h1>Notifications</h1>
        <p>Know when an agent needs your decision.</p>
      </header>
      <section className={styles.notificationSetup}>
        {support === "install" && (
          <div className={styles.phoneIllustration} aria-hidden>
            <div>
              <BrandMark className="size-6" />
              <span>
                Scope<strong>An agent needs your approval</strong>
              </span>
            </div>
          </div>
        )}
        <h2>
          {enabled
            ? "You’re ready for the next request"
            : support === "install"
              ? "Take Scope with you"
              : support === "denied"
                ? "Notifications are turned off"
                : support === "unsupported"
                  ? "Try another device"
                  : support === "checking"
                    ? "Checking this device…"
                    : "Alerts in this browser"}
        </h2>
        <p>
          {enabled
            ? ""
            : support === "install"
              ? "On iPhone, add Scope to your Home Screen so access requests can reach you."
              : support === "denied"
                ? "Allow notifications for Scope in your device settings."
                : support === "unsupported"
                  ? "Use a browser that supports push notifications."
                  : "Allow Scope notifications on this device."}
        </p>
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
          {canEnable && (
            <Button
              className={styles.approve}
              disabled={!!busy}
              onClick={() => void enable()}
            >
              {busy === "enable"
                ? "Enabling…"
                : enabled
                  ? "Reconnect notifications"
                  : "Enable notifications"}
            </Button>
          )}
          {enabled && (
            <button
              className={styles.textAction}
              disabled={!!busy}
              onClick={() => void test()}
            >
              {busy === "test" ? "Sending…" : "Send a test notification"}
            </button>
          )}
        </div>
        {message && (
          <p role="status" className={styles.notice}>
            {message}
          </p>
        )}
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        <p className={styles.setupAside}>
          <Link className={styles.textAction} href="/approvals">
            Open requests
          </Link>
        </p>
      </section>
    </BoardShell>
  );
}
