self.addEventListener("push", (event) => {
  let requestId;
  try {
    const value = event.data?.json()?.requestId;
    if (typeof value === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(value))
      requestId = value;
  } catch {
    /* A malformed notification still opens the authenticated inbox. */
  }
  const url = requestId
    ? `/lab?request=${encodeURIComponent(requestId)}#request-${encodeURIComponent(requestId)}`
    : "/lab#approvals";
  event.waitUntil(
    self.registration.showNotification("Scope approval requested", {
      body: "Open Scope to review the requester and selected account.",
      tag: requestId ? `scope-approval-${requestId}` : "scope-approval-test",
      data: { url },
    }),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(
    event.notification.data?.url ?? "/lab#approvals",
    self.location.origin,
  );
  if (target.origin !== self.location.origin || target.pathname !== "/lab")
    return;
  event.waitUntil(self.clients.openWindow(target.href));
});
