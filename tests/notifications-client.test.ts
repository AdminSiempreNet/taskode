import { test } from "node:test";
import assert from "node:assert/strict";
import { NotificationsClient } from "../src/lib/notifications-client";
import type { NotificationsSnapshot } from "../src/lib/notifications";
function snapshot(ids: string[]): NotificationsSnapshot {
  return {
    items: ids.map((id) => ({
      id,
      type: "assigned",
      actorName: "Ana",
      taskId: "task",
      projectId: "project",
      projectName: "Proyecto",
      taskTitle: id,
      offsetMinutes: null,
      createdAt: "2026-10-18T12:00:00.000Z",
      readAt: null,
    })),
    unreadCount: ids.length,
    nextCursor: null,
    through: null,
    realtime: { enabled: false, channel: null },
  };
}
test("cliente no muestra el historial como toast y deduplica las novedades entre recargas", async () => {
  let data = snapshot(["old"]);
  const received: string[] = [];
  const client = new NotificationsClient("user", {
    fetch: async () => Response.json(data),
    visible: () => true,
    newItem: (item) => received.push(item.id),
  });
  client.start();
  await client.refresh();
  assert.deepEqual(received, []);
  data = snapshot(["new", "old"]);
  await client.refresh();
  await client.refresh();
  assert.deepEqual(received, ["new"]);
  data = snapshot(["new", "old", "historical"]);
  data.items[2].createdAt = "2026-10-17T12:00:00.000Z";
  await client.refresh();
  assert.deepEqual(received, ["new"]);
  client.stop();
  client.start();
  await client.refresh();
  assert.deepEqual(received, ["new"]);
  client.stop();
});
test("cliente rechaza fallos de lectura y detiene el tiempo real al caducar la sesión", async () => {
  let authorized = true;
  const client = new NotificationsClient("user", {
    fetch: async (_url, init) =>
      init?.method === "PATCH"
        ? new Response(null, { status: 503 })
        : authorized
          ? Response.json(snapshot([]))
          : new Response(null, { status: 401 }),
    visible: () => true,
  });
  client.start();
  await client.refresh();
  await assert.rejects(client.read("id"), /No se pudo/);
  authorized = false;
  await client.refresh();
  assert.equal(client.state.snapshot, null);
  assert.match(client.state.error, /sesión/);
  client.stop();
});
test("cliente recupera datos desde el transporte y no anuncia avisos en segundo plano", async () => {
  let data = snapshot(["old"]),
    changed!: () => void,
    closed = 0;
  data.realtime = { enabled: true, channel: "private-user" };
  const received: string[] = [];
  const client = new NotificationsClient("user", {
    fetch: async () => Response.json(data),
    visible: () => false,
    newItem: (item) => received.push(item.id),
    connect: async (_channel, callback, status) => {
      changed = callback;
      status(true);
      return () => {
        closed++;
      };
    },
  });
  client.start();
  await client.refresh();
  assert.equal(client.state.live, true);
  data = { ...data, ...snapshot(["new", "old"]), realtime: data.realtime };
  changed();
  await client.refresh();
  assert.equal(client.state.snapshot?.unreadCount, 2);
  assert.deepEqual(received, []);
  client.stop();
  assert.equal(closed, 1);
});
