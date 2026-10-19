const ownerKey = "taskode.push-user";
export function pushSupported() {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}
export async function registerPush(
  userId: string,
  publicKey: string,
  askPermission: boolean,
) {
  if (!pushSupported())
    throw Error(
      "Este navegador no admite push o necesita una conexión segura.",
    );
  if (askPermission && (await Notification.requestPermission()) !== "granted")
    throw Error(
      "Activa el permiso de notificaciones en la configuración del navegador.",
    );
  if (Notification.permission !== "granted") return false;
  const registration = await navigator.serviceWorker.register("/sw.js", {
    scope: "/",
    updateViaCache: "none",
  });
  await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  const owner = localStorage.getItem(ownerKey);
  if (subscription && owner !== userId) {
    await subscription.unsubscribe();
    subscription = null;
  }
  if (!subscription && !askPermission) return false;
  if (!subscription) {
    const raw = atob(publicKey.replace(/-/g, "+").replace(/_/g, "/"));
    const key = Uint8Array.from(raw, (c) => c.charCodeAt(0));
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: key,
    });
  }
  const response = await fetch("/api/push/subscriptions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(subscription.toJSON()),
  });
  if (!response.ok)
    throw Error("No se pudo activar este dispositivo. Inténtalo de nuevo.");
  localStorage.setItem(ownerKey, userId);
  return true;
}
export async function disablePush() {
  if (!pushSupported()) return;
  const registration = await navigator.serviceWorker.getRegistration("/");
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription) {
    const response = await fetch("/api/push/subscriptions", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    });
    if (!response.ok)
      throw Error(
        "No se pudo desactivar este dispositivo. Inténtalo de nuevo.",
      );
    await subscription.unsubscribe();
  }
  localStorage.removeItem(ownerKey);
}
