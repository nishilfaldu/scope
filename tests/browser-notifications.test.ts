// @vitest-environment node
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { afterEach, expect, test, vi } from "vitest";
import {
  activeRegistration,
  notificationSupport,
  enableBrowserNotifications,
} from "../lib/browser-notifications";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function browser(permission = "default", ios = false, standalone = false) {
  vi.stubGlobal("window", {
    isSecureContext: true,
    PushManager: {},
    Notification: {},
    matchMedia: () => ({ matches: standalone }),
  });
  vi.stubGlobal("navigator", {
    userAgent: ios ? "iPhone" : "Chrome",
    platform: "",
    maxTouchPoints: 0,
    serviceWorker: {},
  });
  vi.stubGlobal("Notification", {
    permission,
    requestPermission: vi.fn().mockResolvedValue("denied"),
  });
}
test("iPhone browser requires Home Screen installation before requesting permission", async () => {
  browser("default", true);
  expect(notificationSupport()).toBe("install");
  await expect(enableBrowserNotifications("key")).rejects.toThrow(
    "Home Screen",
  );
  expect(Notification.requestPermission).not.toHaveBeenCalled();
  browser("default", true, true);
  expect(notificationSupport()).toBe("default");
});
test("permission refusal stops setup before registration", async () => {
  browser();
  await expect(enableBrowserNotifications("key")).rejects.toThrow("blocked");
  expect(Notification.requestPermission).toHaveBeenCalledOnce();
});
test("existing lab subscription is reused after moving notification settings", async () => {
  browser("granted");
  const subscription = {
    endpoint: "https://push.example/device",
    toJSON: () => ({ keys: { p256dh: "key", auth: "auth" } }),
  };
  const registration = {
    scope: "https://scope.example/lab",
    active: { scriptURL: "https://scope.example/probe-sw.js" },
    pushManager: {
      getSubscription: vi.fn().mockResolvedValue(subscription),
      subscribe: vi.fn(),
    },
  };
  const register = vi.fn().mockResolvedValue(registration);
  Object.assign(navigator.serviceWorker, {
    getRegistrations: vi.fn().mockResolvedValue([registration]),
    register,
  });
  expect(await enableBrowserNotifications("cHVibGlj")).toEqual({
    endpoint: subscription.endpoint,
    p256dh: "key",
    auth: "auth",
  });
  expect(register).toHaveBeenCalledWith("/probe-sw.js", {
    scope: "/lab",
    updateViaCache: "none",
  });
  expect(registration.pushManager.subscribe).not.toHaveBeenCalled();
});
test("worker activation timeout fails with an actionable message", async () => {
  vi.useFakeTimers();
  const worker = {
    state: "installing",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  const result = activeRegistration({
    installing: worker,
  } as unknown as ServiceWorkerRegistration);
  const assertion = expect(result).rejects.toThrow("timed out");
  await vi.advanceTimersByTimeAsync(15000);
  await assertion;
  expect(worker.removeEventListener).toHaveBeenCalled();
});
test("notification clicks stay on Scope and support old and new approval links", async () => {
  const listeners: Record<string, (event: unknown) => void> = {};
  const showNotification = vi.fn();
  const openWindow = vi.fn();
  runInNewContext(readFileSync("public/probe-sw.js", "utf8"), {
    URL,
    self: {
      addEventListener: (name: string, fn: (e: unknown) => void) =>
        (listeners[name] = fn),
      location: { origin: "https://scope.example" },
      registration: { showNotification },
      clients: { openWindow },
    },
  });
  listeners.push({
    data: { json: () => ({ requestId: "request-123" }) },
    waitUntil: vi.fn(),
  });
  expect(showNotification.mock.calls[0][1].data.url).toContain(
    "/approvals?request=request-123",
  );
  const click = (url: string) =>
    listeners.notificationclick({
      notification: { close: vi.fn(), data: { url } },
      waitUntil: vi.fn(),
    });
  click("https://evil.example/approvals");
  click("/connections");
  expect(openWindow).not.toHaveBeenCalled();
  click("/lab?request=legacy");
  click("/approvals?request=new");
  expect(openWindow).toHaveBeenCalledTimes(2);
});
