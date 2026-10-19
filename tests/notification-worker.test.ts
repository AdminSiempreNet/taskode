import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

function worker(windows: unknown[] = []) {
  const handlers = new Map<string, (event: unknown) => void>();
  const shown: { title: string; options: Record<string, unknown> }[] = [];
  const opened: string[] = [];
  const self = {
    location: { origin: "https://taskode.test" },
    addEventListener: (name: string, handler: (event: unknown) => void) =>
      handlers.set(name, handler),
    skipWaiting: async () => {},
    registration: {
      showNotification: async (
        title: string,
        options: Record<string, unknown>,
      ) => {
        shown.push({ title, options });
      },
    },
    clients: {
      claim: async () => {},
      matchAll: async () => windows,
      openWindow: async (url: string) => {
        opened.push(url);
      },
    },
  };
  runInNewContext(readFileSync("public/sw.js", "utf8"), { self, URL });
  return { handlers, shown, opened };
}
test("service worker usa texto mínimo y una etiqueta estable para deduplicar", async () => {
  const w = worker(),
    id = "a1234567-1234-1234-1234-123456789abc";
  const promises: Promise<void>[] = [];
  const event = {
    data: {
      json: () => ({
        notificationId: id,
        title: "Privado",
        body: "No exponer",
        url: "https://evil.test",
      }),
    },
    waitUntil: (p: Promise<void>) => promises.push(p),
  };
  w.handlers.get("push")!(event);
  w.handlers.get("push")!(event);
  await Promise.all(promises);
  assert.equal(w.shown.length, 2);
  assert.equal(w.shown[0].title, "Taskode");
  assert.equal(w.shown[0].options.body, "Tienes una nueva notificación.");
  assert.equal(w.shown[0].options.tag, w.shown[1].options.tag);
  w.handlers.get("push")!({
    ...event,
    data: { json: () => ({ notificationId: "https://evil.test" }) },
  });
  assert.equal(w.shown.length, 2);
});
test("clic push reutiliza una ventana con navegación protegida o abre un enlace autenticado", async () => {
  const id = "a1234567-1234-1234-1234-123456789abc",
    messages: unknown[] = [];
  let focused = false,
    closed = false,
    completion!: Promise<void>;
  const w = worker([
    {
      url: "https://taskode.test/projects/p/tasks/t",
      postMessage: (message: unknown) => messages.push(message),
      focus: async () => {
        focused = true;
      },
    },
  ]);
  const event = {
    notification: {
      data: { notificationId: id },
      close: () => {
        closed = true;
      },
    },
    waitUntil: (p: Promise<void>) => {
      completion = p;
    },
  };
  w.handlers.get("notificationclick")!(event);
  await completion;
  assert.ok(focused && closed);
  assert.equal(w.opened.length, 0);
  assert.equal((messages[0] as { notificationId: string }).notificationId, id);
  const fresh = worker();
  fresh.handlers.get("notificationclick")!(event);
  await completion;
  assert.equal(
    fresh.opened[0],
    `https://taskode.test/notifications?open=${id}`,
  );
});
