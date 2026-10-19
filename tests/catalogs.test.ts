import { test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { actor, addUser, createRepository } from "./helpers";
import { CatalogsService } from "../src/server/catalogs";
import { paginationSchema, pageMetadata } from "../src/lib/pagination";
import { normalizeClientText } from "../src/lib/clients";
import { ticketPageSchema } from "../src/lib/catalogs";
import { entityPath } from "../src/lib/routes";
import type { Actor, EntityKind } from "../src/lib/types";
import * as s from "../src/server/schema";

const query = (values = {}) => paginationSchema.parse(values);

test("paginación: límites, tamaños permitidos y página vacía", () => {
  assert.deepEqual(query(), { page: 1, pageSize: 25, q: "" });
  assert.deepEqual(query({ page: "2", pageSize: "50", q: "  café  " }), { page: 2, pageSize: 50, q: "café" });
  for (const values of [{ page: 0 }, { page: -1 }, { page: 1.5 }, { page: 1_000_001 }, { pageSize: 500 }, { pageSize: 0 }, { q: "a".repeat(201) }])
    assert.equal(paginationSchema.safeParse(values).success, false);
  assert.deepEqual(pageMetadata(0, 100), { total: 0, page: 1, pageSize: 25, totalPages: 1 });
  assert.deepEqual(pageMetadata(51, 4), { total: 51, page: 3, pageSize: 25, totalPages: 3 });
  assert.equal(ticketPageSchema.safeParse({ clientId: "client", withoutClient: "true" }).success, false);
  assert.equal(ticketPageSchema.safeParse({ withoutClient: "yes" }).success, false);
  assert.equal(ticketPageSchema.safeParse({ clientId: "" }).success, false);
  assert.equal(ticketPageSchema.safeParse({ clientId: "c".repeat(201) }).success, false);
});

test("filtro de tickets por cliente se combina con búsqueda, conteo y paginación", async () => {
  const repo = await createRepository();
  try {
    const service = new CatalogsService(repo), now = new Date().toISOString();
    await repo.store.db.insert(s.clients).values(["a", "b"].map((id) => ({ id, name: `Cliente ${id}`, normalizedName: `cliente ${id}`, cityId: "05001", createdAt: now, updatedAt: now })));
    await repo.store.db.insert(s.tickets).values(Array.from({ length: 82 }, (_, i) => ({
      id: `filter-${i}`, number: String(i).padStart(3, "0"), description: i % 2 ? "Pendiente" : "Resuelto", url: null,
      clientId: i < 50 ? "a" : i < 70 ? "b" : null, createdAt: now, updatedAt: now,
    })));
    const first = await service.tickets(actor, { ...query(), clientId: "a" });
    const second = await service.tickets(actor, { ...query({ page: 2 }), clientId: "a" });
    assert.equal(first.total, 50); assert.equal(first.items.length, 25);
    assert.equal(second.total, 50); assert.equal(second.items.length, 25);
    assert.equal(new Set([...first.items, ...second.items].map((ticket) => ticket.id)).size, 50);
    assert.ok([...first.items, ...second.items].every((ticket) => ticket.clientId === "a"));
    assert.equal((await service.tickets(actor, { ...query({ q: "pendiente" }), clientId: "a" })).total, 25);
    assert.equal((await service.tickets(actor, { ...query(), clientId: "missing" })).total, 0);
    const unassigned = await service.tickets(actor, { ...query({ page: 5 }), withoutClient: true });
    assert.equal(unassigned.total, 12); assert.equal(unassigned.page, 1);
    assert.ok(unassigned.items.every((ticket) => ticket.clientId === null));
    assert.equal((await service.tickets(actor, query())).total, 82);
  } finally { await repo.close(); }
});

test("vínculos del ticket: cuatro tipos, páginas y permisos de proyectos y tareas privadas", async () => {
  const repo = await createRepository();
  try {
    const service = new CatalogsService(repo);
    const viewer = await addUser(repo, "viewer"), outsider = await addUser(repo, "outsider"), noAccess = await addUser(repo, "no-access");
    const ticketId = (await repo.execute({ type: "ticket.create", number: "LINKS", description: "", url: null, clientId: null }, actor)).createdId!;
    const createScope = async (owner: Actor, name: string) => {
      const projectId = (await repo.execute({ type: "project.create", name, description: "", icon: "P", color: "#059669" }, owner)).createdId!;
      const moduleId = (await repo.execute({ type: "module.create", projectId, name: `${name} módulo`, description: "" }, owner)).createdId!;
      const featureId = (await repo.execute({ type: "feature.create", projectId, moduleId, name: `${name} feature`, description: "" }, owner)).createdId!;
      const workspace = await repo.getWorkspace(owner);
      const taskId = (await repo.execute({ type: "task.create", projectId, featureId, statusId: workspace.statuses.find((status) => status.projectId === projectId)!.id,
        title: `${name} tarea`, description: "", priority: "medium", dueDate: null, labels: [] }, owner)).createdId!;
      const entities = { project: projectId, module: moduleId, feature: featureId, task: taskId };
      for (const [kind, id] of Object.entries(entities))
        await repo.execute({ type: "entity.tickets.update", scope: { kind: kind as EntityKind, id, projectId }, ticketIds: [ticketId] }, owner);
      return { ...entities, projectId, taskId };
    };
    const visible = await createScope(actor, "Visible"), hidden = await createScope(outsider, "Privado");
    await repo.execute({ type: "project.team.add", projectId: visible.projectId, userId: viewer.id }, actor);
    for (const kind of ["project", "module", "feature", "task"] as const) {
      const admin = await service.ticketLinks(actor, ticketId, kind, query());
      assert.equal(admin.total, 2);
      assert.ok(admin.items.some((link) => link.id === visible[kind]));
      const allowed = await service.ticketLinks(viewer, ticketId, kind, query());
      assert.equal(allowed.total, kind === "task" ? 0 : 1);
      assert.ok(allowed.items.every((link) => link.id !== hidden[kind]));
      assert.equal((await service.ticketLinks(noAccess, ticketId, kind, query())).total, 0);
      if (kind !== "task") assert.equal(allowed.items[0].href, entityPath(visible.projectId, kind, visible[kind], "board", "tickets"));
    }
    await repo.execute({ type: "task.assignment.update", id: visible.taskId, leaderId: actor.id, teamMemberIds: [viewer.id] }, actor);
    await repo.execute({ type: "task.archive", id: visible.taskId, archived: true }, actor);
    const allowedTask = await service.ticketLinks(viewer, ticketId, "task", query());
    assert.equal(allowedTask.total, 1); assert.equal(allowedTask.items[0].name, "Visible tarea");
    const [template] = await repo.store.db.select().from(s.tasks).where(eq(s.tasks.id, visible.taskId));
    const extras = Array.from({ length: 30 }, (_, i) => ({ ...template, id: `extra-${i}`, title: `Tarea ${String(i).padStart(2, "0")}` }));
    await repo.store.db.insert(s.tasks).values(extras);
    await repo.store.db.insert(s.taskTickets).values(extras.map((task) => ({ taskId: task.id, ticketId })));
    const first = await service.ticketLinks(actor, ticketId, "task", query({ pageSize: 10 }));
    const second = await service.ticketLinks(actor, ticketId, "task", query({ page: 2, pageSize: 10 }));
    assert.equal(first.total, 32); assert.equal(second.items.length, 10);
    assert.equal(new Set([...first.items, ...second.items].map((link) => link.id)).size, 20);
    assert.equal((await service.ticketLinks(viewer, ticketId, "task", query())).total, 1);
    assert.equal((await service.ticketLinks(actor, ticketId, "task", query({ q: "Privado" }))).total, 1);
    await assert.rejects(service.ticketLinks({ id: "unknown" }, ticketId, "task", query()), { status: 401 });
    await assert.rejects(service.ticketLinks(actor, "missing", "task", query()), { status: 404 });
    // Assigning only a project does not create implicit module/feature/task links.
    const other = (await repo.execute({ type: "ticket.create", number: "ONLY-PROJECT", description: "", url: null, clientId: null,
      scope: { kind: "project", id: visible.projectId, projectId: visible.projectId } }, actor)).createdId!;
    assert.equal((await service.ticketLinks(actor, other, "project", query())).total, 1);
    assert.equal((await service.ticketLinks(actor, other, "task", query())).total, 0);
  } finally { await repo.close(); }
});

test("clientes paginados: búsqueda global, orden estable, selección y borrado de última página", async () => {
  const repo = await createRepository();
  try {
    const service = new CatalogsService(repo), now = new Date().toISOString();
    const member = await addUser(repo, "catalog-reader");
    const rows = Array.from({ length: 61 }, (_, i) => ({
      id: `client-${i}`, name: i === 60 ? "Zulu Café 100%_\\" : `Cliente ${String(i).padStart(3, "0")}`,
      normalizedName: "", cityId: "05001", createdAt: now, updatedAt: now,
    })).map((row) => ({ ...row, normalizedName: normalizeClientText(row.name) }));
    await repo.store.db.insert(s.clients).values(rows);
    const pages = await Promise.all([1, 2, 3].map((page) => service.clients(member, query({ page }))));
    assert.deepEqual(pages.map((page) => page.items.length), [25, 25, 11]);
    assert.equal(pages[0].total, 61);
    assert.equal(new Set(pages.flatMap((page) => page.items.map((client) => client.id))).size, 61);
    assert.deepEqual(await service.clients(member, query({ page: 2 })), pages[1]);
    const accent = await service.clients(member, query({ q: "CAFE 100%_\\" }));
    assert.deepEqual(accent.items.map((client) => client.id), ["client-60"]);
    assert.equal((await service.clients(member, query({ q: "medellin" }))).total, 61);
    assert.equal((await service.clients(member, query({ q: "antioquia" }))).total, 61);
    assert.equal((await service.clients(member, query({ q: "missing" }))).total, 0);
    assert.equal((await service.clients(member, query(), "client-60")).items[0].name, rows[60].name);
    assert.equal((await service.clients(member, query({ pageSize: 100 }))).items.length, 61);
    await repo.store.db.delete(s.clients).where(eq(s.clients.id, "client-60"));
    const clamped = await service.clients(member, query({ page: 7, pageSize: 10 }));
    assert.equal(clamped.page, 6); assert.equal(clamped.items.length, 10);
    const lean = await repo.getWorkspace(member, { includeCatalogs: false });
    assert.deepEqual(lean.clients, []); assert.deepEqual(lean.tickets, []);
    assert.equal((await repo.getWorkspace(member)).clients.length, 60);
    await assert.rejects(service.clients({ id: "unknown" }, query()), { status: 401 });
  } finally { await repo.close(); }
});

test("tickets paginados: duplicados, descripción, enlace, cliente y conteo con relaciones opcionales", async () => {
  const repo = await createRepository();
  try {
    const service = new CatalogsService(repo), now = new Date().toISOString();
    await repo.store.db.insert(s.clients).values({ id: "cafe", name: "Café del sur", normalizedName: "cafe del sur", cityId: "05001", createdAt: now, updatedAt: now });
    await repo.store.db.insert(s.tickets).values(Array.from({ length: 61 }, (_, i) => ({
      id: `ticket-${String(i).padStart(3, "0")}`, number: "00042", description: i === 60 ? "Último 100%_" : "General",
      url: i === 60 ? "https://example.com/referencia" : null, clientId: i === 60 ? "cafe" : null, createdAt: now, updatedAt: now,
    })));
    const pages = await Promise.all([1, 2, 3].map((page) => service.tickets(actor, query({ page }))));
    assert.deepEqual(pages.map((page) => page.items.length), [25, 25, 11]);
    assert.equal(new Set(pages.flatMap((page) => page.items.map((ticket) => ticket.id))).size, 61);
    assert.equal(pages[0].items[0].client, null);
    assert.equal((await service.tickets(actor, query({ q: "00042" }))).total, 61);
    for (const q of ["ultimo 100%_", "CAFE DEL SUR", "referencia"])
      assert.deepEqual((await service.tickets(actor, query({ q }))).items.map((ticket) => ticket.id), ["ticket-060"]);
    const selected = await service.tickets(actor, query({ q: "cafe" }));
    assert.equal(selected.items[0].client?.cityName, "MEDELLÍN");
    await repo.store.db.delete(s.tickets).where(eq(s.tickets.id, "ticket-060"));
    const clamped = await service.tickets(actor, query({ page: 7, pageSize: 10 }));
    assert.equal(clamped.page, 6); assert.equal(clamped.items.length, 10);
    const lean = await repo.getWorkspace(actor, { includeCatalogs: false });
    assert.deepEqual(lean.tickets, []);
    assert.equal((await repo.getWorkspace(actor)).tickets.length, 60);
    await assert.rejects(service.tickets({ id: "unknown" }, query()), { status: 401 });
  } finally { await repo.close(); }
});
