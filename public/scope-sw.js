// Replace the old worker at once. Otherwise it keeps handling pushes until every Scope tab closes.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);

function text(value, max) {
  return typeof value === "string" ? value.slice(0, max) : undefined;
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data?.json() ?? {};
  } catch {
    /* A malformed notification still opens the authenticated inbox. */
  }
  if (data.test === true) {
    event.waitUntil(
      self.registration.showNotification("Scope notifications work", {
        body: "Agent requests will appear on this device.",
        tag: "scope-test",
      }),
    );
    return;
  }
  const approvalId =
    typeof data.approvalId === "string" &&
    /^[a-zA-Z0-9_-]{1,100}$/.test(data.approvalId)
      ? data.approvalId
      : undefined;
  const minutes = data.approveMinutes === 0 ? 0 : 30;
  const actions = approvalId
    ? [
        ...(data.quickApprove === true
          ? [
              {
                action: "approve",
                title:
                  text(data.approveLabel, 40) ??
                  (minutes ? "Approve 30 min" : "Approve once"),
              },
            ]
          : []),
        { action: "deny", title: "Deny" },
      ]
    : [];
  event.waitUntil(
    self.registration.showNotification(
      text(data.title, 120) ?? "Scope approval requested",
      {
        body: text(data.body, 400) ?? "Open Scope to review the request.",
        tag: approvalId ? `scope-approval-${approvalId}` : "scope-approval",
        requireInteraction: true,
        actions,
        data: {
          approvalId,
          minutes,
          url: approvalId
            ? `/requests?request=${encodeURIComponent(approvalId)}`
            : "/requests",
        },
      },
    ),
  );
});

async function decide(approvalId, decision, minutes, tag) {
  try {
    const response = await fetch("/api/approvals/decide", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: approvalId, decision, minutes }),
      // An expired session redirects to sign-in. Treat that as a failure.
      redirect: "manual",
    });
    if (!response.ok) return false;
    await self.registration.showNotification(
      decision === "deny"
        ? "Request denied"
        : minutes
          ? "Approved for 30 minutes"
          : "Approved once",
      { tag, silent: true },
    );
    return true;
  } catch {
    return false;
  }
}

async function openPage(url) {
  const target = new URL(url ?? "/requests", self.location.origin);
  if (target.origin !== self.location.origin || target.pathname !== "/requests")
    return;
  await self.clients.openWindow(target.href);
}

self.addEventListener("notificationclick", (event) => {
  const { approvalId, minutes, url } = event.notification.data ?? {};
  const tag = event.notification.tag;
  event.notification.close();
  if (approvalId && (event.action === "approve" || event.action === "deny")) {
    event.waitUntil(
      decide(approvalId, event.action, minutes === 0 ? 0 : 30, tag).then(
        (done) => done || openPage(url),
      ),
    );
    return;
  }
  event.waitUntil(openPage(url));
});
