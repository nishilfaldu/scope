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
    options: {
      applicationServerKey: Uint8Array.from(Buffer.from("public")).buffer,
    },
    endpoint: "https://push.example/device",
    toJSON: () => ({ keys: { p256dh: "key", auth: "auth" } }),
  };
  const registration = {
    scope: "https://scope.example/lab",
    active: { scriptURL: "https://scope.example/scope-sw.js" },
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
    replacedEndpoint: undefined,
    endpoint: subscription.endpoint,
    p256dh: "key",
    auth: "auth",
  });
  expect(register).toHaveBeenCalledWith("/scope-sw.js", {
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
  runInNewContext(readFileSync("public/scope-sw.js", "utf8"), {
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
    "/access?request=request-123",
  );
  const click = (url: string) =>
    listeners.notificationclick({
      notification: { close: vi.fn(), data: { url } },
      waitUntil: vi.fn(),
    });
  click("https://evil.example/access");
  click("/connections");
  expect(openWindow).not.toHaveBeenCalled();
  click("/lab?request=legacy");
  click("/access?request=new");
  expect(openWindow).toHaveBeenCalledTimes(2);
});

test("VAPID rotation replaces stale browser subscriptions", async () => {
  browser("granted");
  const old = {
    endpoint: "https://push.example/old",
    options: { applicationServerKey: Uint8Array.from([1, 2]).buffer },
    unsubscribe: vi.fn().mockResolvedValue(true),
  };
  const subscribe = vi.fn().mockResolvedValue({
    endpoint: "https://push.example/new",
    toJSON: () => ({ keys: { p256dh: "new-key", auth: "new-auth" } }),
  });
  const registration = {
    scope: "https://scope.example/",
    active: { scriptURL: "https://scope.example/scope-sw.js" },
    pushManager: { getSubscription: async () => old, subscribe },
  };
  Object.assign(navigator.serviceWorker, {
    getRegistrations: async () => [registration],
    register: async () => registration,
  });
  expect(await enableBrowserNotifications("cHVibGlj")).toEqual({
    replacedEndpoint: old.endpoint,
    endpoint: "https://push.example/new",
    p256dh: "new-key",
    auth: "new-auth",
  });
  expect(old.unsubscribe).toHaveBeenCalledOnce();
  expect(subscribe).toHaveBeenCalledWith({
    userVisibleOnly: true,
    applicationServerKey: Uint8Array.from(Buffer.from("public")),
  });
});
