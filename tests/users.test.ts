import { test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { actor, addUser, authConfig, createRepository } from "./helpers";
import * as s from "../src/server/schema";
import { InvitationService } from "../src/server/invitations";
import { flushNotificationDeliveries, subscribePush } from "../src/server/notification-delivery";
import { PostgresRepository } from "../src/server/postgres";
import { validateApplicationBackup } from "../src/server/backup-data";
import { sendNotificationEmail } from "../src/server/notification-email";

const fields = { name: "Accesos", description: "", icon: "👥", color: "#059669" };

test("Resend recibe la clave de idempotencia y una señal de tiempo máximo; un fallo se conserva como error", async () => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.RESEND_API_KEY, previousFrom = process.env.RESEND_FROM_EMAIL;
  try {
    process.env.RESEND_API_KEY = "re_test"; process.env.RESEND_FROM_EMAIL = "Taskode <avisos@example.com>";
    let attempts = 0;
    globalThis.fetch = async (_url, options) => {
      const headers = new Headers(options?.headers);
      assert.equal(headers.get("Idempotency-Key"), "taskode-delivery:test");
      assert.ok(options?.signal instanceof AbortSignal);
      const body = JSON.parse(String(options?.body)); assert.equal(body.to, "target@example.com");
      attempts++;
      return new Response(JSON.stringify(attempts === 1 ? { id: "sent" } : { name: "application_error", message: "Offline" }), { status: attempts === 1 ? 200 : 503 });
    };
    const message = { to: "target@example.com", subject: "Acceso", text: "Aviso", html: "<p>Aviso</p>" };
    await sendNotificationEmail(message, "taskode-delivery:test");
    await assert.rejects(sendNotificationEmail(message, "taskode-delivery:test"), /email-delivery-failed/);
    assert.equal(attempts, 2);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = previousKey;
    if (previousFrom === undefined) delete process.env.RESEND_FROM_EMAIL; else process.env.RESEND_FROM_EMAIL = previousFrom;
  }
});

test("usuarios: accesos efectivos, permisos administrativos y asignación directa por correo normalizado sin invitación duplicada", async () => {
  const repo = await createRepository();
  try {
    const member = await addUser(repo, "registered"), other = await addUser(repo, "outside");
    const p = (await repo.execute({ type: "project.create", ...fields }, actor)).createdId!;
    const p2 = (await repo.execute({ type: "project.create", ...fields, name: "Otro" }, actor)).createdId!;
    await assert.rejects(repo.users.list(member), { status: 403 });
    await assert.rejects(repo.users.projects(other, member.id), { status: 403 });
    const service = new InvitationService(repo, authConfig.BETTER_AUTH_SECRET, authConfig.BETTER_AUTH_URL);
    const first = await service.create({ email: " REGISTERED@EXAMPLE.COM ", projectIds: [p, p] }, actor);
    assert.equal(first.kind, "assigned"); assert.deepEqual(first.addedProjectIds, [p]);
    const second = await service.create({ email: "registered@example.com", projectIds: [p, p2] }, actor);
    assert.equal(second.kind, "assigned"); assert.deepEqual(second.addedProjectIds, [p2]);
    assert.equal((await repo.store.db.select().from(s.invitations)).length, 0);
    const users = await repo.users.list(actor);
    assert.equal(users.find(u => u.id === actor.id)!.projectAccess.filter(a => a.source === "admin").length, 2);
    assert.equal(users.find(u => u.id === member.id)!.projectAccess.length, 2);
    assert.equal(users.find(u => u.id === other.id)!.projectAccess.length, 0);
    assert.equal((await repo.notifications.list(member)).unreadCount, 2);
    await service.create({ email: "registered@example.com", projectIds: [p, p2] }, actor);
    assert.equal((await repo.notifications.list(member)).unreadCount, 2);
    const snapshot = await repo.users.projects(actor, member.id);
    await repo.users.update(actor, member.id, { revision: snapshot.revision, addProjectIds: [], removeProjectIds: [] });
    assert.equal((await repo.notifications.list(member)).unreadCount, 2);
    const admin = await repo.users.projects(actor, actor.id);
    await assert.rejects(repo.users.update(actor, actor.id, { revision: admin.revision, addProjectIds: [], removeProjectIds: [p] }), { status: 409 });
    const removed = await repo.users.update(actor, member.id, { revision: snapshot.revision, addProjectIds: [], removeProjectIds: [p2] });
    assert.deepEqual(removed.user.projectAccess.map(a => a.projectId), [p]);
  } finally { await repo.close(); }
});

test("retirada atómica transfiere todos los liderazgos, incluye tareas archivadas/terminadas y limpia equipos sin perder integrantes", async () => {
  const repo = await createRepository();
  try {
    const departing = await addUser(repo, "departing"), successor = await addUser(repo, "successor"), teammate = await addUser(repo, "teammate");
    const p = (await repo.execute({ type: "project.create", ...fields }, actor)).createdId!;
    for (const u of [departing, successor, teammate]) await repo.execute({ type: "project.team.add", projectId: p, userId: u.id }, actor);
    await repo.execute({ type: "project.leader.update", id: p, userId: departing.id }, actor);
    const m = (await repo.execute({ type: "module.create", projectId: p, name: "Módulo a transferir", description: "" }, actor)).createdId!;
    const f = (await repo.execute({ type: "feature.create", projectId: p, moduleId: m, name: "Feature a transferir", description: "" }, actor)).createdId!;
    await repo.execute({ type: "module.assignment.update", id: m, leaderId: departing.id, teamMemberIds: [teammate.id] }, actor);
    await repo.execute({ type: "feature.assignment.update", id: f, leaderId: departing.id, teamMemberIds: [teammate.id] }, actor);
    const w = await repo.getWorkspace(actor), taskIds: string[] = [];
    for (let i = 0; i < 2; i++) {
      const id = (await repo.execute({ type: "task.create", projectId: p, featureId: f, statusId: w.statuses.find(s => s.isDone === !!i)!.id, title: `Responsabilidad ${i}`, description: "Conservar", priority: "medium", dueDate: "2099-10-20", labels: [], leaderId: departing.id, teamMemberIds: [successor.id, teammate.id] }, actor)).createdId!;
      if (!i) await repo.execute({ type: "task.archive", id, archived: true }, actor);
      taskIds.push(id);
    }
    const snapshot = await repo.users.projects(actor, departing.id);
    const responsibility = snapshot.projects.find(pj => pj.projectId === p)!;
    assert.deepEqual([responsibility.leadsProject, responsibility.tasks, responsibility.modules, responsibility.features], [true, 2, 1, 1]);
    await assert.rejects(repo.users.update(actor, departing.id, { revision: snapshot.revision, addProjectIds: [], removeProjectIds: [p] }), { status: 409 });
    assert.equal((await repo.getWorkspace(actor)).projects[0].leaderId, departing.id);
    const next = await repo.users.update(actor, departing.id, { revision: snapshot.revision, addProjectIds: [], removeProjectIds: [p], replacements: [{ projectId: p, userId: successor.id }] });
    assert.equal(next.user.projectAccess.length, 0);
    const result = await repo.getWorkspace(actor);
    assert.equal(result.projects[0].leaderId, successor.id);
    assert.equal(result.modules.find(row => row.id === m)!.leaderId, successor.id);
    assert.equal(result.features.find(row => row.id === f)!.leaderId, successor.id);
    for (const id of taskIds) {
      const task = result.tasks.find(t => t.id === id)!;
      assert.equal(task.leaderId, successor.id); assert.equal(task.description, "Conservar");
      assert.deepEqual(task.teamMemberIds, [teammate.id]);
    }
    for (const table of [s.projectTeamMembers, s.moduleTeamMembers, s.featureTeamMembers, s.taskTeamMembers]) assert.equal((await repo.store.db.select().from(table).where(eq(table.userId, departing.id))).length, 0);
    assert.equal((await repo.getWorkspace(departing)).projects.length, 0);
    const notices = await repo.notifications.list(departing);
    assert.ok(notices.items.some(n => n.type === "project_access_removed"));
    assert.equal(notices.items.filter(n => ["assigned", "shared"].includes(n.type)).length, 0);
    const removed = notices.items.find(n => n.type === "project_access_removed")!;
    assert.equal((await repo.notifications.get(departing, removed.id)).url, "/projects");
    const granted = notices.items.find(n => n.type === "project_access_granted")!;
    assert.equal((await repo.notifications.get(departing, granted.id)).url, "/projects");
    await repo.notifications.read(departing, { through: notices.through! });
    assert.equal((await repo.notifications.list(departing)).unreadCount, 0);
  } finally { await repo.close(); }
});

test("conflictos y reemplazos inválidos no dejan guardados parciales; los enlaces pendientes no restituyen permisos retirados", async () => {
  const repo = await createRepository();
  try {
    const service = new InvitationService(repo, authConfig.BETTER_AUTH_SECRET, authConfig.BETTER_AUTH_URL);
    const p = (await repo.execute({ type: "project.create", ...fields }, actor)).createdId!;
    const legacy = await service.create({ email: "later@example.com", projectIds: [p] }, actor);
    assert.equal(legacy.kind, "invitation");
    const member = await addUser(repo, "later"), outsider = await addUser(repo, "outside");
    const p2 = (await repo.execute({ type: "project.create", ...fields, name: "Conservar aislado" }, actor)).createdId!;
    await repo.execute({ type: "project.team.add", projectId: p, userId: member.id }, actor);
    await assert.rejects(service.verify(service.token(legacy.invitation)));
    const first = await repo.users.projects(actor, member.id);
    await repo.execute({ type: "project.leader.update", id: p, userId: member.id }, actor);
    await assert.rejects(repo.users.update(actor, member.id, { revision: first.revision, addProjectIds: [p2], removeProjectIds: [p], replacements: [{ projectId: p, userId: actor.id }] }), { status: 409 });
    const current = await repo.users.projects(actor, member.id);
    await assert.rejects(repo.users.update(actor, member.id, { revision: current.revision, addProjectIds: [p2], removeProjectIds: [p], replacements: [{ projectId: p, userId: outsider.id }] }), { status: 409 });
    assert.deepEqual((await repo.users.projects(actor, member.id)).user.projectAccess.map(a => a.projectId), [p]);
    await assert.rejects(service.resend(legacy.invitation.id, actor), { status: 409 });
    // A database failure after additions still rolls the entire multi-project edit back.
    await repo.store.pool.query(`create function fail_removal() returns trigger language plpgsql as $$ begin raise exception 'simulated removal failure'; end $$; create trigger fail_removal before delete on project_team_members for each row execute function fail_removal()`);
    await assert.rejects(repo.users.update(actor, member.id, { revision: current.revision, addProjectIds: [p2], removeProjectIds: [p], replacements: [{ projectId: p, userId: actor.id }] }));
    assert.equal((await repo.getWorkspace(actor)).projects.find(row => row.id === p)!.leaderId, member.id);
    assert.deepEqual((await repo.users.projects(actor, member.id)).user.projectAccess.map(a => a.projectId), [p]);
  } finally { await repo.close(); }
});

test("correo de invitación persiste ante fallos, reintenta con la misma clave y descarta enlaces revocados o vencidos", async () => {
  const repo = await createRepository();
  try {
    const service = new InvitationService(repo, authConfig.BETTER_AUTH_SECRET, authConfig.BETTER_AUTH_URL);
    const created = await service.create({ email: "pending@example.com" }, actor); assert.equal(created.kind, "invitation");
    const keys: string[] = [];
    const send = { invalidate: async () => {}, push: async () => {}, email: async (_mail: unknown, key: string) => { keys.push(key); throw Error("offline"); } };
    const failed = await flushNotificationDeliveries(repo, send);
    assert.equal(failed.failed, 1); assert.equal(failed.pending, 1);
    assert.equal((await service.list(actor))[0].deliveryStatus, "failed");
    const delivered = await flushNotificationDeliveries(repo, { ...send, email: async (mail, key) => { keys.push(key); assert.equal(mail.to, "pending@example.com"); assert.match(mail.html, /Taskode/); } }, { now: new Date(Date.now() + 120000) });
    assert.equal(delivered.sent, 1); assert.equal(delivered.pending, 0); assert.equal(keys[0], keys[1]);
    assert.equal((await service.list(actor))[0].deliveryStatus, "sent");
    const revoked = await service.create({ email: "revoked@example.com" }, actor); assert.equal(revoked.kind, "invitation");
    await service.revoke(revoked.invitation.id, actor);
    const expired = await service.create({ email: "expired@example.com" }, actor); assert.equal(expired.kind, "invitation");
    await repo.store.db.update(s.invitations).set({ expiresAt: Date.now() - 1 }).where(eq(s.invitations.id, expired.invitation.id));
    await flushNotificationDeliveries(repo, { ...send, email: async () => { assert.fail("No enviar una invitación obsoleta"); } });
    assert.equal((await repo.store.db.select().from(s.notificationDeliveries)).length, 0);
  } finally { await repo.close(); }
});

test("accesos entregan por los tres canales; retirada conserva su aviso y descarta concesiones obsoletas", async () => {
  const repo = await createRepository();
  try {
    const member = await addUser(repo, "recipient"), now = new Date();
    const p = (await repo.execute({ type: "project.create", ...fields }, actor)).createdId!;
    await repo.store.db.insert(s.session).values({ id: "device", token: "device-token", userId: member.id, createdAt: now, updatedAt: now, expiresAt: new Date(now.getTime() + 86400000) });
    await subscribePush(repo, member.id, "device", { endpoint: "https://fcm.googleapis.com/user-access", keys: { p256dh: Buffer.alloc(65, 1).toString("base64url"), auth: Buffer.alloc(16, 2).toString("base64url") } });
    await repo.execute({ type: "project.team.add", projectId: p, userId: member.id }, actor);
    const notice = (await repo.notifications.list(member)).items[0];
    const calls = { ably: 0, push: 0, email: 0 };
    const send = { invalidate: async () => { calls.ably++; }, push: async () => { calls.push++; }, email: async () => { calls.email++; } };
    await flushNotificationDeliveries(repo, send); assert.deepEqual(calls, { ably: 1, push: 1, email: 1 });
    assert.equal((await repo.notifications.get(member, notice.id)).url, `/projects/${p}`);
    await repo.execute({ type: "project.team.remove", projectId: p, userId: member.id }, actor);
    assert.equal(await repo.notifications.deliveryValid(notice.id), false);
    await flushNotificationDeliveries(repo, send); assert.deepEqual(calls, { ably: 4, push: 2, email: 2 });
    assert.equal((await repo.notifications.list(member)).unreadCount, 2);
    const removed = (await repo.notifications.list(member)).items[0];
    assert.equal(removed.type, "project_access_removed"); assert.equal(await repo.notifications.deliveryValid(removed.id), true);
    await flushNotificationDeliveries(repo, send); assert.equal(calls.email, 2);
  } finally { await repo.close(); }
});

test("aceptación sin proyectos avisa una vez al administrador; respaldo v12 conserva destinos de cuenta sin reproducir entregas", async () => {
  const repo = await createRepository(), dir = await mkdtemp(join(tmpdir(), "users-backup-"));
  try {
    const service = new InvitationService(repo, authConfig.BETTER_AUTH_SECRET, authConfig.BETTER_AUTH_URL);
    const created = await service.create({ email: "new-user@example.com" }, actor); assert.equal(created.kind, "invitation");
    const member = await addUser(repo, "new-user");
    await service.consume(service.token(created.invitation), member.id, "new-user@example.com");
    await assert.rejects(service.consume(service.token(created.invitation), member.id, "new-user@example.com"));
    const inbox = await repo.notifications.list(actor); assert.equal(inbox.items.length, 1);
    assert.equal(inbox.items[0].type, "invitation_accepted"); assert.equal(inbox.items[0].projectId, null);
    assert.equal((await repo.notifications.get(actor, inbox.items[0].id)).url, `/users?user=${member.id}`);
    const calls: string[] = [];
    await flushNotificationDeliveries(repo, { invalidate: async () => { calls.push("ably"); }, push: async () => {}, email: async mail => { assert.equal(mail.to, "test-admin@example.com"); calls.push("email"); } });
    assert.deepEqual(calls.sort(), ["ably", "email"]);
    const path = join(dir, "backup.json"); await repo.exportBackup(path);
    const backup = JSON.parse(await readFile(path, "utf8")); assert.equal(validateApplicationBackup(backup).version, 12);
    await repo.restoreBackup(path);
    assert.equal((await repo.notifications.list(actor)).items[0].type, "invitation_accepted");
    assert.equal((await repo.store.db.select().from(s.notificationDeliveries)).length, 0);
    const legacy = structuredClone(backup); legacy.version = 11; legacy.tables.notifications = [];
    assert.equal(validateApplicationBackup(legacy).version, 12);
  } finally { await repo.close(); await rm(dir, { recursive: true, force: true }); }
});

test("dos trabajadores reservan un correo una sola vez", async () => {
  const repo = await createRepository();
  const other = new PostgresRepository(repo.store.connectionString, { schema: repo.store.schemaName });
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), start = new Promise<void>(resolve => { entered = resolve; });
  try {
    await new InvitationService(repo, authConfig.BETTER_AUTH_SECRET, authConfig.BETTER_AUTH_URL).create({ email: "one@example.com" }, actor);
    const running = flushNotificationDeliveries(repo, { invalidate: async () => {}, push: async () => {}, email: async () => { entered(); await gate; } });
    await start;
    const peer = await flushNotificationDeliveries(other, { invalidate: async () => {}, push: async () => {}, email: async () => { assert.fail("Correo duplicado"); } });
    assert.equal(peer.sent, 0); assert.equal(peer.failed, 0); release(); assert.equal((await running).sent, 1);
  } finally { release(); await other.close(); await repo.close(); }
});

test("migración 0013 retoma solo invitaciones pendientes vigentes sin repetir correos enviados ni cuentas existentes", async () => {
  const repo = await createRepository();
  try {
    await addUser(repo, "already-registered");
    const now = Date.now();
    const cases = [
      { id: "pending", email: "pending@example.com", deliveryStatus: "pending" },
      { id: "failed", email: "failed@example.com", deliveryStatus: "failed" },
      { id: "sent", email: "sent@example.com", deliveryStatus: "sent" },
      { id: "known", email: "already-registered@example.com", deliveryStatus: "failed" },
      { id: "expired", email: "expired@example.com", deliveryStatus: "failed", expiresAt: now - 1 },
      { id: "revoked", email: "revoked@example.com", deliveryStatus: "pending", revokedAt: now },
      { id: "accepted", email: "accepted@example.com", deliveryStatus: "pending", acceptedAt: now },
    ];
    await repo.store.db.insert(s.invitations).values(cases.map(c => ({ createdAt: now, expiresAt: now + 86400000, createdBy: actor.id, ...c })));
    // Recreate only the pre-0013 shape in the disposable test schema.
    await repo.store.pool.query('alter table notification_deliveries drop constraint notification_delivery_target, drop column "invitationId"; alter table notification_deliveries alter column "recipientId" set not null; alter table notifications alter column "projectId" set not null');
    await repo.store.pool.query(await readFile("drizzle/postgresql/0013_users_invitations.sql", "utf8"));
    const jobs = await repo.store.db.select().from(s.notificationDeliveries);
    assert.deepEqual(jobs.map(j => j.invitationId).sort(), ["failed", "pending"]);
    assert.ok(jobs.every(j => j.recipientId === null && j.transport === "email"));
  } finally { await repo.close(); }
});
