import { test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { actor, addUser, createRepository } from "./helpers";
import * as s from "../src/server/schema";
import { reminderTimes, projectClock } from "../src/lib/project-time";
import {
  flushNotificationDeliveries,
  subscribePush,
  validPushEndpoint,
  workerAuthorized,
} from "../src/server/notification-delivery";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateApplicationBackup } from "../src/server/backup-data";
import { PostgresRepository } from "../src/server/postgres";

async function fixture() {
  const repo = await createRepository();
  const leader = await addUser(repo, "leader"),
    member = await addUser(repo, "member"),
    other = await addUser(repo, "other");
  const projectId = (
    await repo.execute(
      {
        type: "project.create",
        name: "Proyecto",
        description: "",
        color: "#059669",
        icon: "P",
      },
      actor,
    )
  ).createdId!;
  for (const person of [leader, member, other])
    await repo.execute(
      { type: "project.team.add", projectId, userId: person.id },
      actor,
    );
  const w = await repo.getWorkspace(actor);
  const create = () =>
    repo.execute(
      {
        type: "task.create",
        projectId,
        featureId: w.features[0].id,
        statusId: w.statuses.find((s) => !s.isDone)!.id,
        title: "Aviso",
        description: "",
        priority: "medium",
        dueDate: "2099-10-20",
        dueTime: "10:00",
        labels: [],
        leaderId: leader.id,
        teamMemberIds: [member.id],
      },
      actor,
    );
  const taskId = (await create()).createdId!;
  return { repo, leader, member, other, projectId, taskId, create };
}

test("asignación y uso compartido son atómicos, privados y no se repiten al guardar", async () => {
  const f = await fixture();
  try {
    assert.equal(
      (await f.repo.notifications.list(f.leader)).items[0].type,
      "assigned",
    );
    assert.equal(
      (await f.repo.notifications.list(f.member)).items[0].type,
      "shared",
    );
    assert.equal((await f.repo.notifications.list(actor)).unreadCount, 0);
    await f.repo.execute(
      {
        type: "task.assignment.update",
        id: f.taskId,
        leaderId: f.leader.id,
        teamMemberIds: [f.member.id],
      },
      actor,
    );
    assert.equal((await f.repo.notifications.list(f.member)).items.length, 1);
    await f.repo.execute(
      {
        type: "task.assignment.update",
        id: f.taskId,
        leaderId: f.member.id,
        teamMemberIds: [f.leader.id],
      },
      actor,
    );
    assert.equal(
      (await f.repo.notifications.list(f.member)).items.filter(
        (n) => n.type === "assigned",
      ).length,
      1,
    );
    assert.equal((await f.repo.notifications.list(f.leader)).items.length, 1);
    const notification = (await f.repo.notifications.list(f.member)).items[0];
    await assert.rejects(
      f.repo.notifications.get(f.other, notification.id),
      /no existe/,
    );
    await assert.rejects(
      f.repo.execute(
        {
          type: "task.assignment.update",
          id: f.taskId,
          leaderId: "missing",
          teamMemberIds: [],
        },
        actor,
      ),
    );
    assert.equal((await f.repo.notifications.list(f.member)).items.length, 2);
    await f.repo.execute(
      {
        type: "task.assignment.update",
        id: f.taskId,
        leaderId: f.leader.id,
        teamMemberIds: [],
      },
      actor,
    );
    assert.equal((await f.repo.notifications.list(f.member)).unreadCount, 0);
    await assert.rejects(f.repo.notifications.get(f.member, notification.id));
  } finally {
    await f.repo.close();
  }
});

test("lectura colectiva respeta el límite, paginación estable y notificaciones nuevas", async () => {
  const f = await fixture();
  try {
    const first = await f.repo.notifications.list(f.leader);
    const newer = await f.create();
    // Arrival order must remain reliable even when another instance's clock lags.
    await f.repo.store.db
      .update(s.notifications)
      .set({ createdAt: new Date(Date.parse(first.items[0].createdAt) - 1000) })
      .where(eq(s.notifications.taskId, newer.createdId!));
    await f.repo.notifications.read(f.leader, { through: first.through! });
    assert.equal((await f.repo.notifications.list(f.leader)).unreadCount, 1);
    const page = await f.repo.notifications.list(f.leader, { limit: 1 });
    assert.ok(page.nextCursor);
    const next = await f.repo.notifications.list(f.leader, {
      limit: 1,
      cursor: page.nextCursor!,
    });
    assert.notEqual(next.items[0].id, page.items[0].id);
    await f.repo.notifications.read(f.leader, {
      id: first.items[0].id,
      read: false,
    });
    assert.equal(
      (await f.repo.notifications.list(f.leader, { filter: "unread" }))
        .unreadCount,
      2,
    );
    await assert.rejects(
      f.repo.notifications.list(f.leader, { cursor: "invalid" }),
      /Cursor/,
    );
  } finally {
    await f.repo.close();
  }
});

test("recordatorios: preferencias, recuperación del último umbral y archivo", async () => {
  const f = await fixture();
  try {
    await f.repo.notifications.savePreferences(f.member, {
      offsets: [15],
      dateOnlyTime: "08:00",
    });
    const jobs = await f.repo.store.db.select().from(s.taskReminders);
    assert.equal(jobs.filter((j) => j.userId === f.member.id).length, 1);
    const now = new Date("2099-10-20T14:50:00Z"); // 09:50 Bogotá
    assert.equal(await f.repo.notifications.processReminders(now), 2);
    assert.equal(await f.repo.notifications.processReminders(now), 0);
    const leader = (await f.repo.notifications.list(f.leader)).items.filter(
      (i) => i.type === "reminder",
    );
    assert.equal(leader.length, 1);
    assert.equal(leader[0].offsetMinutes, 60);
    await f.repo.execute(
      { type: "task.archive", id: f.taskId, archived: true },
      actor,
    );
    assert.equal(
      (await f.repo.store.db.select().from(s.taskReminders)).filter(
        (j) => !j.processedAt,
      ).length,
      0,
    );
    await assert.rejects(
      f.repo.notifications.savePreferences(f.leader, {
        offsets: [15, 15],
        dateOnlyTime: "25:00",
      }),
    );
  } finally {
    await f.repo.close();
  }
});

test("zonas, días completos y DST conservan la hora local acordada", () => {
  assert.equal(
    reminderTimes("2026-10-20", null, "America/Bogota", 60, "08:00"),
    null,
  );
  assert.equal(
    reminderTimes(
      "2026-10-20",
      null,
      "America/Bogota",
      1440,
      "08:00",
    )!.scheduledFor.toISOString(),
    "2026-10-19T13:00:00.000Z",
  );
  assert.equal(
    reminderTimes(
      "2026-03-09",
      null,
      "America/New_York",
      1440,
      "08:00",
    )!.scheduledFor.toISOString(),
    "2026-03-08T12:00:00.000Z",
  );
  assert.equal(
    reminderTimes(
      "2026-03-08",
      "02:30",
      "America/New_York",
      60,
      "08:00",
    )!.scheduledFor.toISOString(),
    "2026-03-08T06:30:00.000Z",
  );
  assert.equal(
    projectClock(new Date("2026-10-20T03:00:00Z"), "America/Bogota").day,
    "2026-10-19",
  );
});

test("entregas se reintentan sin perder datos; sesiones y endpoints caducados se retiran", async () => {
  const f = await fixture();
  try {
    const now = new Date();
    await f.repo.store.db.insert(s.session).values({
      id: "push-session",
      token: "push-token",
      userId: f.leader.id,
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(now.getTime() + 86400000),
    });
    await subscribePush(f.repo, f.leader.id, "push-session", {
      endpoint: "https://fcm.googleapis.com/test",
      keys: {
        p256dh: Buffer.alloc(65, 1).toString("base64url"),
        auth: Buffer.alloc(16, 2).toString("base64url"),
      },
    });
    await f.create();
    const failed = await flushNotificationDeliveries(f.repo, {
      invalidate: async () => {
        throw Error("offline");
      },
      push: async () => {
        throw { statusCode: 410 };
      },
    });
    assert.ok(failed.failed > 0);
    assert.equal(
      (await f.repo.store.db.select().from(s.pushSubscriptions)).length,
      0,
    );
    const sent: string[] = [];
    const result = await flushNotificationDeliveries(
      f.repo,
      {
        invalidate: async (_user, id) => {
          sent.push(id);
        },
        push: async () => {},
      },
      { now: new Date(Date.now() + 120000) },
    );
    assert.ok(result.sent > 0);
    assert.equal(new Set(sent).size, sent.length);
    assert.equal((await f.repo.notifications.list(f.leader)).items.length, 2);
    await subscribePush(f.repo, f.leader.id, "push-session", {
      endpoint: "https://fcm.googleapis.com/test",
      keys: {
        p256dh: Buffer.alloc(65, 1).toString("base64url"),
        auth: Buffer.alloc(16, 2).toString("base64url"),
      },
    });
    await f.repo.store.db
      .delete(s.session)
      .where(eq(s.session.id, "push-session"));
    assert.equal(
      (await f.repo.store.db.select().from(s.pushSubscriptions)).length,
      0,
    );
  } finally {
    await f.repo.close();
  }
});

test("respaldos v8 conservan preferencias e historial, sin suscripciones ni trabajos", async () => {
  const f = await fixture(),
    dir = await mkdtemp(join(tmpdir(), "notifications-"));
  try {
    await f.repo.notifications.savePreferences(f.leader, {
      offsets: [4320],
      dateOnlyTime: "09:15",
    });
    const path = join(dir, "backup.json");
    await f.repo.exportBackup(path);
    const backup = JSON.parse(await readFile(path, "utf8"));
    assert.equal(backup.version, 10);
    assert.equal(backup.tables.projects[0].timeZone, "America/Bogota");
    assert.equal(backup.tables.notifications.length, 2);
    assert.equal(backup.tables.push_subscriptions, undefined);
    assert.equal(validateApplicationBackup(backup).version, 10);
    await f.repo.restoreBackup(path);
    assert.deepEqual(await f.repo.notifications.preferences(f.leader), {
      offsets: [4320],
      dateOnlyTime: "09:15",
    });
    assert.equal(
      (await f.repo.store.db.select().from(s.notificationDeliveries)).length,
      0,
    );
    await f.repo.notifications.processReminders();
    assert.ok(
      (await f.repo.store.db.select().from(s.taskReminders)).length > 0,
    );
  } finally {
    await f.repo.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("programador exige secreto y push bloquea destinos privados", () => {
  const secret = "s".repeat(32);
  assert.ok(
    workerAuthorized(
      new Request("https://example.com", {
        headers: { Authorization: `Bearer ${secret}` },
      }),
      secret,
    ),
  );
  assert.equal(
    workerAuthorized(new Request("https://example.com"), secret),
    false,
  );
  assert.equal(validPushEndpoint("https://127.0.0.1/push"), false);
  assert.equal(
    validPushEndpoint("https://fcm.googleapis.com.evil.test/push"),
    false,
  );
});

test("zona por proyecto, horas personales y cambios de fecha cancelan trabajos anteriores", async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      f.repo.execute(
        {
          type: "project.timezone.update",
          id: f.projectId,
          timeZone: "Europe/Madrid",
        },
        f.member,
      ),
    );
    await f.repo.execute(
      {
        type: "project.timezone.update",
        id: f.projectId,
        timeZone: "Europe/Madrid",
      },
      actor,
    );
    const task = (await f.repo.getWorkspace(actor)).tasks.find(
      (t) => t.id === f.taskId,
    )!;
    await f.repo.execute(
      { type: "task.update", ...task, dueTime: null },
      actor,
    );
    await f.repo.notifications.savePreferences(f.leader, {
      offsets: [1440, 60],
      dateOnlyTime: "08:00",
    });
    await f.repo.notifications.savePreferences(f.member, {
      offsets: [1440],
      dateOnlyTime: "09:30",
    });
    const jobs = await f.repo.store.db.select().from(s.taskReminders);
    assert.equal(jobs.length, 2);
    assert.equal(
      jobs.find((j) => j.userId === f.leader.id)!.scheduledFor.toISOString(),
      "2099-10-19T06:00:00.000Z",
    );
    assert.equal(
      jobs.find((j) => j.userId === f.member.id)!.scheduledFor.toISOString(),
      "2099-10-19T07:30:00.000Z",
    );
    await f.repo.notifications.processReminders(
      new Date("2099-10-19T08:00:00Z"),
    );
    const reminder = (await f.repo.notifications.list(f.leader)).items.find(
      (n) => n.type === "reminder",
    )!;
    assert.ok(
      await f.repo.notifications.deliveryValid(
        reminder.id,
        new Date("2099-10-19T08:00:00Z"),
      ),
    );
    await f.repo.execute(
      { type: "task.update", ...task, dueDate: "2099-10-25", dueTime: null },
      actor,
    );
    assert.equal(
      await f.repo.notifications.deliveryValid(
        reminder.id,
        new Date("2099-10-19T08:00:00Z"),
      ),
      false,
    );
    assert.equal(
      (await f.repo.getWorkspace(actor)).projects[0].timeZone,
      "Europe/Madrid",
    );
  } finally {
    await f.repo.close();
  }
});

test("dos trabajadores no entregan el mismo trabajo y la retirada de acceso descarta avisos", async () => {
  const f = await fixture(),
    second = new PostgresRepository(f.repo.store.connectionString, {
      schema: f.repo.store.schemaName,
    });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    let started!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const ids: string[] = [];
    const running = flushNotificationDeliveries(f.repo, {
      invalidate: async (_user, id) => {
        ids.push(id);
        started();
        await gate;
      },
      push: async () => {},
    });
    await entered;
    const other = await flushNotificationDeliveries(second, {
      invalidate: async () => {
        assert.fail("Entrega duplicada");
      },
      push: async () => {},
    });
    assert.equal(other.sent, 0);
    release();
    await running;
    assert.equal(new Set(ids).size, ids.length);
    await f.create();
    await f.repo.execute(
      {
        type: "project.team.remove",
        projectId: f.projectId,
        userId: f.member.id,
      },
      actor,
    );
    const result = await flushNotificationDeliveries(f.repo, {
      invalidate: async (user, _id, notification) => {
        if (notification) assert.notEqual(user, f.member.id);
      },
      push: async () => {},
    });
    assert.ok(result.discarded > 0);
  } finally {
    release();
    await second.close();
    await f.repo.close();
  }
});

test("respaldo v6 recibe zona inicial y tablas vacías; acciones propias no generan avisos", async () => {
  const f = await fixture(),
    dir = await mkdtemp(join(tmpdir(), "notifications-v6-"));
  try {
    const before = (await f.repo.notifications.list(f.leader)).items.length;
    const task = (await f.repo.getWorkspace(actor)).tasks.find(
      (t) => t.id === f.taskId,
    )!;
    await f.repo.execute(
      {
        type: "task.create",
        ...task,
        leaderId: f.leader.id,
        teamMemberIds: [],
      },
      f.leader,
    );
    assert.equal(
      (await f.repo.notifications.list(f.leader)).items.length,
      before,
    );
    const path = join(dir, "v7.json");
    await f.repo.exportBackup(path);
    const v6 = JSON.parse(await readFile(path, "utf8"));
    v6.version = 6;
    delete v6.tables.documents;
    delete v6.tables.diagrams;
    delete v6.tables.notifications;
    delete v6.tables.notification_preferences;
    for (const project of v6.tables.projects) delete project.timeZone;
    const normalized = validateApplicationBackup(v6);
    assert.equal(normalized.version, 10);
    assert.equal(normalized.tables.projects[0].timeZone, "America/Bogota");
    assert.deepEqual(normalized.tables.notifications, []);
  } finally {
    await f.repo.close();
    await rm(dir, { recursive: true, force: true });
  }
});
