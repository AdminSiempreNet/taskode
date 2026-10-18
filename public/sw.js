/* Taskode's worker only handles notifications. Authenticated pages are never cached. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);
self.addEventListener("push", (event) => {
  let data;
  try {
    data = event.data?.json();
  } catch {
    return;
  }
  if (
    !data ||
    typeof data.notificationId !== "string" ||
    !/^[a-f0-9-]{36}$/.test(data.notificationId)
  )
    return;
  const notificationId = data.notificationId;
  event.waitUntil(
    self.registration.showNotification("Taskode", {
      body: "Tienes una nueva notificación.",
      icon: "/pwa-icon/192",
      badge: "/pwa-icon/192",
      tag: `taskode:${notificationId}`,
      renotify: false,
      data: { notificationId },
    }),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const id = event.notification.data?.notificationId;
  if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id)) return;
  const url = new URL(
    `/notifications?open=${encodeURIComponent(id)}`,
    self.location.origin,
  ).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        if (
          !/^\/(dashboard|projects|clients|notifications)(\/|$)/.test(
            new URL(client.url).pathname,
          )
        ) {
          await client.navigate(url);
          await client.focus();
          return;
        }
        // The page performs guarded navigation so unsaved edits remain protected.
        client.postMessage({
          type: "taskode:open-notification",
          notificationId: id,
        });
        await client.focus();
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
