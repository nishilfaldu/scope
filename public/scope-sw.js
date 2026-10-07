self.addEventListener("push", (event) => {
  let approvalId;
  try {
    const value = event.data?.json()?.approvalId;
    if (typeof value === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(value))
      approvalId = value;
  } catch {
    /* A malformed notification still opens the authenticated inbox. */
  }
  const url = approvalId
    ? `/requests?request=${encodeURIComponent(approvalId)}`
    : "/requests";
  event.waitUntil(
    self.registration.showNotification("Scope approval requested", {
      body: "Open Scope to review the agent and its reason.",
      tag: approvalId ? `scope-approval-${approvalId}` : "scope-approval-test",
      data: { url },
    }),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(
    event.notification.data?.url ?? "/requests",
    self.location.origin,
  );
  if (target.origin !== self.location.origin || target.pathname !== "/requests")
    return;
  event.waitUntil(self.clients.openWindow(target.href));
});
