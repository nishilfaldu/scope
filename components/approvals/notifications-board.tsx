"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { BoardShell } from "@/components/layout/board-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { approvalPost } from "@/lib/approval-display";
import {
  notificationSupport,
  enableBrowserNotifications,
  type NotificationSupport,
} from "@/lib/browser-notifications";

export function NotificationsBoard() {
  const subscribe = useMutation(api.probe.subscribe);
  const [support, setSupport] = useState<NotificationSupport>("checking");
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const refresh = () => setSupport(notificationSupport());
    refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
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
      setEnabled(true);
      setMessage(
        "Notifications enabled on this device. Send a test to check delivery.",
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
            ? `Test accepted for ${result.sent} subscribed device${result.sent === 1 ? "" : "s"}${result.failed ? `; ${result.failed} failed` : ""}. Check your device for receipt; service acceptance does not confirm delivery.`
            : "No test notifications were accepted. Enable notifications on a device and try again.",
      );
    } catch {
      setError("Could not send a test. Check your sign-in and try again.");
    } finally {
      setBusy(null);
    }
  }
  const canEnable = ["default", "granted"].includes(support);
  return (
    <BoardShell title="Notifications">
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 lg:px-8 lg:py-10">
        <h1 className="text-2xl font-semibold tracking-tight">
          Stay close to your approvals
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
          Get a notification when an agent needs access. Open it to review the
          account and reason, then make your decision in Scope.
        </p>
        <section className="mt-8 overflow-hidden rounded-xl border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b p-5">
            <h2 className="font-semibold">This device</h2>
            <Badge
              variant={
                enabled && support === "granted" ? "default" : "secondary"
              }
            >
              {enabled && support === "granted"
                ? "Enabled"
                : support === "checking"
                  ? "Checking…"
                  : support === "granted"
                    ? "Permission granted"
                    : support === "denied"
                      ? "Blocked in settings"
                      : support === "install"
                        ? "Home Screen required"
                        : support === "unsupported"
                          ? "Not supported"
                          : "Not enabled"}
            </Badge>
          </div>
          <div className="space-y-5 p-5 sm:p-6">
            <p className="text-sm leading-6 text-muted-foreground">
              {support === "install"
                ? "On iPhone or iPad, install Scope using the steps below. Then open its Home Screen icon to enable notifications."
                : support === "denied"
                  ? "Notifications are blocked for Scope. Allow notifications in your browser or device settings, then return here."
                  : support === "unsupported"
                    ? "This browser cannot receive push notifications. You can still review requests in your inbox, or set up Scope on a supported device."
                    : "Enable notifications separately on each device you use. If permission is already granted, this reconnects the device to your signed-in Scope account."}
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button
                className="h-11"
                disabled={!!busy || !canEnable}
                onClick={() => void enable()}
              >
                {busy === "enable"
                  ? "Enabling…"
                  : enabled
                    ? "Reconnect notifications"
                    : "Enable notifications"}
              </Button>
              <Button
                className="h-11"
                variant="outline"
                disabled={!!busy || support === "checking"}
                onClick={() => void test()}
              >
                {busy === "test" ? "Sending…" : "Send test notification"}
              </Button>
            </div>
            {message && (
              <p
                role="status"
                className="rounded-lg bg-muted p-3 text-sm leading-6"
              >
                {message}
              </p>
            )}
            {error && (
              <p role="alert" className="text-sm leading-6 text-destructive">
                {error}
              </p>
            )}
          </div>
        </section>
        <section className="mt-6 rounded-xl border bg-card p-5 sm:p-6">
          <h2 className="font-semibold">Set up your iPhone or iPad</h2>
          <ol className="mt-5 space-y-5">
            {[
              [
                "Add Scope to your Home Screen",
                "Open this Scope address in Safari. Tap Share, then Add to Home Screen. Keep Open as Web App enabled if that option appears.",
              ],
              [
                "Open Scope from its icon",
                "Sign in to the same Scope account. Your requests and connected accounts will be here.",
              ],
              [
                "Enable notifications and send a test",
                "Return to Notifications, tap Enable notifications, and allow the device prompt. Tap a test notification to confirm it opens Scope.",
              ],
            ].map(([title, text], i) => (
              <li key={title} className="flex gap-3">
                <span
                  aria-hidden
                  className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium"
                >
                  {i + 1}
                </span>
                <div>
                  <h3 className="text-sm font-medium">{title}</h3>
                  <p className="mt-1 max-w-xl text-sm leading-6 text-muted-foreground">
                    {text}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </section>
        <p className="mt-5 max-w-xl text-xs leading-5 text-muted-foreground">
          Notifications contain a prompt to review access, never credentials.
          Approval still requires your Scope sign-in. If a notification is
          delayed, open your inbox directly.
        </p>
        <Button
          className="mt-4"
          variant="ghost"
          nativeButton={false}
          render={<Link href="/approvals" />}
        >
          Open approvals
        </Button>
      </main>
    </BoardShell>
  );
}
