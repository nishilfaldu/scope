export type NotificationSupport =
  "checking" | "install" | "unsupported" | "denied" | "default" | "granted";

export function notificationSupport(): NotificationSupport {
  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone;
  if (ios && !standalone) return "install";
  if (
    !window.isSecureContext ||
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    !("Notification" in window)
  )
    return "unsupported";
  return Notification.permission;
}

export async function activeRegistration(
  registration: ServiceWorkerRegistration,
) {
  if (registration.active) return registration;
  const worker = registration.installing ?? registration.waiting;
  if (!worker)
    throw new Error(
      "Notification setup did not start. Reload Scope and try again.",
    );
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      worker.removeEventListener("statechange", check);
    };
    const check = () => {
      if (worker.state === "activated") {
        cleanup();
        resolve();
      } else if (worker.state === "redundant") {
        cleanup();
        reject(
          new Error(
            "Notification setup was interrupted. Reload Scope and try again.",
          ),
        );
      }
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(
        new Error("Notification setup timed out. Reload Scope and try again."),
      );
    }, 15_000);
    worker.addEventListener("statechange", check);
    check();
  });
  return registration;
}

export async function enableBrowserNotifications(publicKey: string) {
  const support = notificationSupport();
  if (support === "install")
    throw new Error(
      "Open Scope from your Home Screen before enabling notifications.",
    );
  if (support === "unsupported")
    throw new Error(
      "This browser does not support notifications. Use a supported browser or open Scope on your phone.",
    );
  if (!publicKey)
    throw new Error(
      "Notifications are not configured for this Scope environment.",
    );
  // Ask from the button gesture, before worker registration or network work.
  if (
    Notification.permission !== "granted" &&
    (await Notification.requestPermission()) !== "granted"
  )
    throw new Error(
      "Notifications are blocked. Allow them in your browser or device settings, then try again.",
    );
  // Retain the old subscription's scope so existing phones do not get duplicates.
  const registrations = await navigator.serviceWorker.getRegistrations();
  const existing = registrations.find(
    (r) =>
      ["/lab", "/"].includes(new URL(r.scope).pathname) &&
      [r.active, r.waiting, r.installing].some(
        (w) => w && new URL(w.scriptURL).pathname === "/scope-sw.js",
      ),
  );
  const registration = await activeRegistration(
    await navigator.serviceWorker.register("/scope-sw.js", {
      scope: existing ? new URL(existing.scope).pathname : "/",
      updateViaCache: "none",
    }),
  );
  let subscription = await registration.pushManager.getSubscription();
  let replacedEndpoint: string | undefined;
  if (subscription && !matchesApplicationKey(subscription, publicKey)) {
    replacedEndpoint = subscription.endpoint;
    if (!(await subscription.unsubscribe()))
      throw new Error("Could not update notification setup. Try again.");
    subscription = null;
  }
  subscription ??= await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: decodeKey(publicKey),
  });
  const data = subscription.toJSON();
  if (!data.keys?.p256dh || !data.keys.auth)
    throw new Error(
      "The browser did not finish notification setup. Try again.",
    );
  return {
    replacedEndpoint,
    endpoint: subscription.endpoint,
    p256dh: data.keys.p256dh,
    auth: data.keys.auth,
  };
}

function decodeKey(key: string) {
  return Uint8Array.from(atob(key.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
    c.charCodeAt(0),
  );
}
export function matchesApplicationKey(
  subscription: PushSubscription,
  publicKey: string,
) {
  if (!publicKey || !subscription.options.applicationServerKey) return false;
  const actual = new Uint8Array(subscription.options.applicationServerKey),
    expected = decodeKey(publicKey);
  return (
    actual.length === expected.length &&
    actual.every((byte, i) => byte === expected[i])
  );
}
