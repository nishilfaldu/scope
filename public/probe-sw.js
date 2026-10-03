self.addEventListener("push", (event) => {
  event.waitUntil(
    self.registration.showNotification("Scope approval requested", {
      body: "Open Scope to review the requester and selected account.",
      tag: "scope-approval",
      data: { url: "/lab" },
    }),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.openWindow(new URL("/lab", self.location.origin).href),
  );
});
