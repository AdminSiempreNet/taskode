import assert from "node:assert/strict";
import { test } from "node:test";
import { sql } from "drizzle-orm";
import { addUser, actor, createRepository } from "./helpers";
import { workspaceOutbox } from "../src/server/schema";
import { flushWorkspaceEvents, type WorkspaceEvent } from "../src/server/realtime";
import { deliverCommandEffects } from "../src/server/commands";
import { PostgresRepository } from "../src/server/postgres";
import { NotificationsClient } from "../src/lib/notifications-client";

async function fixture() {
  const repo = await createRepository();
  const owner = await addUser(repo, "owner"),
    member = await addUser(repo, "member"),
    outsider = await addUser(repo, "outsider");
  const create = async (name: string) =>
    (
      await repo.execute(
        { type: "project.create", name, description: "", icon: "T", color: "#059669" },
        owner,
      )
    ).createdId!;
  const projectId = await create("Tablero");
  const otherProjectId = await create("Otro");
  await repo.execute({ type: "project.team.add", projectId, userId: member.id }, owner);
  const workspace = await repo.getWorkspace(owner);
  const statuses = workspace.statuses.filter((s) => s.projectId === projectId);
  const fields = {
    projectId,
    featureId: workspace.features.find((f) => f.projectId === projectId)!.id,
    statusId: statuses[0].id,
    title: "Mover",
    description: "",
    priority: "medium",
    dueDate: null,
    labels: [],
    leaderId: owner.id,
    teamMemberIds: [],
  };
  const newTask = async (title = "Mover") =>
    (await repo.execute({ type: "task.create", ...fields, title }, owner)).createdId!;
  const outbox = () => repo.store.db.select().from(workspaceOutbox);
  // Project creation writes no tasks, but start every test from a known-empty queue.
  await repo.store.db.delete(workspaceOutbox);
  return { repo, owner, member, outsider, projectId, otherProjectId, statuses, newTask, outbox };
}

test("tablero en tiempo real: escribir tareas encola un único aviso por proyecto al confirmar", async () => {
  const f = await fixture();
  try {
    const taskId = await f.newTask();
    const first = await f.outbox();
    assert.deepEqual(first.map((row) => row.projectId), [f.projectId]);
    await f.repo.execute(
      { type: "task.move", id: taskId, statusId: f.statuses[1].id, beforeId: null },
      f.owner,
    );
    const moved = await f.outbox();
    assert.equal(moved.length, 1, "una ráfaga de escrituras se agrupa en una fila");
    assert.notEqual(moved[0].eventId, first[0].eventId);
    await assert.rejects(
      f.repo.store.transaction(async () => {
        await f.repo.store.db.execute(sql`update tasks set title = 'Revertida'`);
        throw new Error("rollback");
      }),
      /rollback/,
    );
    assert.equal((await f.outbox())[0].eventId, moved[0].eventId, "un rollback no emite avisos");
    await f.repo.store.db.delete(workspaceOutbox);
    await f.repo.store.db.execute(sql`update tasks set title = title`);
    assert.deepEqual(await f.outbox(), [], "una actualización sin cambios no avisa");
    for (const command of [
      { type: "task.archive" as const, id: taskId, archived: true },
      { type: "task.delete" as const, id: taskId },
    ]) {
      await f.repo.store.db.delete(workspaceOutbox);
      await f.repo.execute(command, f.owner);
      assert.deepEqual((await f.outbox()).map((row) => row.projectId), [f.projectId], command.type);
    }
  } finally {
    await f.repo.close();
  }
});

test("tablero en tiempo real: el aviso llega solo a quien puede abrir el proyecto y sin datos de la tarea", async () => {
  const f = await fixture();
  try {
    await f.newTask();
    const sent: { event: WorkspaceEvent; recipients: string[] }[] = [];
    assert.deepEqual(
      await flushWorkspaceEvents(f.repo, async (event, recipients) => {
        sent.push({ event, recipients });
      }),
      { sent: 1, failed: 0 },
    );
    assert.deepEqual(Object.keys(sent[0].event).sort(), ["eventId", "projectId"]);
    assert.equal(sent[0].event.projectId, f.projectId);
    assert.deepEqual(sent[0].recipients.sort(), [actor.id, f.owner.id, f.member.id].sort());
    assert.ok(!sent[0].recipients.includes(f.outsider.id));
    assert.deepEqual(await f.outbox(), []);
  } finally {
    await f.repo.close();
  }
});

test("tablero en tiempo real: un fallo de Ably conserva el aviso y un cambio durante el envío no se pierde", async () => {
  const f = await fixture();
  try {
    const taskId = await f.newTask();
    assert.deepEqual(
      await flushWorkspaceEvents(f.repo, async () => {
        throw new Error("red");
      }),
      { sent: 0, failed: 1 },
    );
    const failed = (await f.outbox())[0];
    assert.equal(failed.attempts, 1);
    assert.equal(failed.leaseUntil, null);
    assert.ok(failed.availableAt.getTime() > Date.now(), "reintenta con espera");
    assert.deepEqual(await flushWorkspaceEvents(f.repo, async () => assert.fail("aún no toca")), {
      sent: 0,
      failed: 0,
    });
    await f.repo.store.db.update(workspaceOutbox).set({ availableAt: new Date(0) });
    await flushWorkspaceEvents(f.repo, async () => {
      await f.repo.execute({ type: "task.rename", id: taskId, title: "Otra" }, f.owner);
    });
    const pending = await f.outbox();
    assert.equal(pending.length, 1, "el ACK del envío anterior no borra el cambio nuevo");
    assert.notEqual(pending[0].eventId, failed.eventId);
    assert.deepEqual(await flushWorkspaceEvents(f.repo, async () => {}), { sent: 1, failed: 0 });
  } finally {
    await f.repo.close();
  }
});

test("tablero en tiempo real: movimientos simultáneos en la misma columna no se bloquean entre sí", async () => {
  const f = await fixture();
  const second = new PostgresRepository(f.repo.store.connectionString, {
    schema: f.repo.store.schemaName,
    max: 3,
  });
  try {
    const ids = [await f.newTask("A"), await f.newTask("B"), await f.newTask("C"), await f.newTask("D")];
    const target = f.statuses[1].id;
    const results = await Promise.allSettled(
      ids.map((id, index) =>
        (index % 2 ? second : f.repo).execute({ type: "task.move", id, statusId: target, beforeId: null }, f.owner),
      ),
    );
    assert.deepEqual(
      results.filter((r) => r.status === "rejected").map((r) => String((r as PromiseRejectedResult).reason)),
      [],
    );
    assert.equal((await f.outbox()).length, 1);
  } finally {
    await second.close();
    await f.repo.close();
  }
});

test("tablero en tiempo real: todo comando drena la cola del tablero", () => {
  const calls: string[] = [];
  const effects = {
    notifications: () => void calls.push("notifications"),
    comments: () => void calls.push("comments"),
    workspace: () => void calls.push("workspace"),
  };
  deliverCommandEffects("feature.delete", effects);
  deliverCommandEffects("label.create", effects);
  assert.deepEqual(calls, ["notifications", "workspace", "workspace"]);
});

test("tablero en tiempo real: el cliente de notificaciones reenvía los avisos del tablero y resincroniza al reconectar", async () => {
  let workspaceChanged!: (projectId: string | null) => void;
  const client = new NotificationsClient("user", {
    fetch: async () =>
      Response.json({
        items: [],
        unreadCount: 0,
        nextCursor: null,
        through: null,
        realtime: { enabled: true, channel: "private-user" },
      }),
    visible: () => true,
    connect: async (_channel, _changed, _status, forward) => {
      workspaceChanged = forward;
      return () => {};
    },
  });
  const received: (string | null)[] = [];
  const release = client.onWorkspaceChanged((projectId) => received.push(projectId));
  await client.refresh();
  workspaceChanged("project");
  workspaceChanged(null);
  assert.deepEqual(received, ["project", null]);
  release();
  workspaceChanged("later");
  assert.deepEqual(received, ["project", null], "al soltar el listener deja de recibir");
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(client.state.live, false, "sin listeners el cliente se detiene");
});
