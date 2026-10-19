import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import { MarkdownManager } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { actor, addUser, createRepository, assertIntegrity } from "./helpers";
import { removeTicketSchema, stripTicketTables } from "./entity-fixtures";
import { commandSchema, type Command } from "../src/lib/validation";
import { ticketInputSchema } from "../src/lib/tickets";
import { contentMentions, mentionMarkdown, mentionQuery, parseMention } from "../src/lib/mentions";
import { Mention } from "../src/components/mentions";
import { createMarkdownParser } from "../src/lib/markdown-parser";
import { MentionsService } from "../src/server/mentions";
import { DocumentsService } from "../src/server/documents";
import { validateApplicationBackup } from "../src/server/backup-data";
import { migrationsFolder } from "../src/server/migration-info";
import type { EntityRef } from "../src/lib/types";

async function fixture() {
  const repo = await createRepository();
  const projectId = (await repo.execute({ type: "project.create", name: "Relaciones", description: "", icon: "R", color: "#059669" }, actor)).createdId!;
  const moduleId = (await repo.execute({ type: "module.create", projectId, name: "Módulo", description: "" }, actor)).createdId!;
  const featureId = (await repo.execute({ type: "feature.create", projectId, moduleId, name: "Feature", description: "" }, actor)).createdId!;
  const workspace = await repo.getWorkspace(actor);
  const fields = { projectId, featureId, statusId: workspace.statuses[0].id, priority: "medium", title: "Tarea", description: "", dueDate: null, labels: [] };
  const taskId = (await repo.execute({ type: "task.create", ...fields }, actor)).createdId!;
  const scopes: EntityRef[] = [{ kind: "project", id: projectId, projectId }, { kind: "module", id: moduleId, projectId }, { kind: "feature", id: featureId, projectId }, { kind: "task", id: taskId, projectId }];
  const client = async (name: string) => (await repo.execute({ type: "client.create", name, cityId: "05001" }, actor)).createdId!;
  const ticket = async (number: string, clientId: string | null = null, scope?: EntityRef) => (await repo.execute({ type: "ticket.create", number, description: "Contexto", url: "https://example.com/ticket", clientId, scope }, actor)).createdId!;
  return { repo, projectId, moduleId, featureId, taskId, scopes, fields, client, ticket };
}

test("tickets globales: número de texto obligatorio, duplicados permitidos y validación de enlace/cliente", async () => {
  const f = await fixture();
  try {
    const member = await addUser(f.repo, "ticket-outsider");
    assert.deepEqual((await f.repo.getWorkspace(member)).projects, []);
    for (const value of [{ number: "" }, { number: "   " }, { number: 123 }, { number: "x".repeat(101) }, { number: "ok", url: "javascript:alert(1)" }, { number: "ok", url: "/relative" }])
      assert.equal(ticketInputSchema.safeParse(value).success, false);
    const first = (await f.repo.execute(commandSchema.parse({ type: "ticket.create", number: " 001234 " }), member)).createdId!;
    const second = (await f.repo.execute(commandSchema.parse({ type: "ticket.create", number: "001234" }), member)).createdId!;
    assert.notEqual(first, second);
    assert.equal((await f.repo.getWorkspace(member)).tickets.filter((ticket) => ticket.number === "001234").length, 2);
    assert.deepEqual((await f.repo.getWorkspace(actor)).tickets.find((ticket) => ticket.id === first)?.clientId, null);
    await assert.rejects(f.repo.execute({ type: "ticket.create", number: "ok", description: "", url: null, clientId: "missing" }, member), { status: 404 });
    await assert.rejects(f.repo.execute({ type: "ticket.create", number: "ok", description: "", url: null, clientId: null }, { id: "unknown" }), { status: 401 });
    await f.repo.execute({ type: "ticket.delete", id: first }, member);
    assert.equal((await f.repo.getWorkspace(actor)).tickets.length, 1);
  } finally { await f.repo.close(); }
});

test("cuatro niveles: asignaciones directas, adición y propagación de cliente, desvinculación y restricciones", async () => {
  const f = await fixture();
  try {
    const oldClient = await f.client("Anterior"), nextClient = await f.client("Nuevo"), manual = await f.client("Manual");
    const ticketId = await f.ticket("00042", oldClient);
    await f.repo.execute({ type: "entity.tickets.update", scope: f.scopes[0], ticketIds: [ticketId, ticketId] }, actor);
    for (const scope of f.scopes.slice(1)) assert.deepEqual((await f.repo.entityDetail(actor, scope.kind, scope.id)).entity.ticketIds, []);
    for (const scope of f.scopes) {
      await f.repo.execute({ type: "entity.clients.update", scope, clientIds: [manual, manual] }, actor);
      if (scope.kind === "project") await f.repo.execute({ type: "entity.tickets.update", scope, ticketIds: [] }, actor);
      await f.repo.execute({ type: "entity.tickets.update", scope, ticketIds: [ticketId, ticketId] }, actor);
      const entity = (await f.repo.entityDetail(actor, scope.kind, scope.id)).entity;
      assert.deepEqual(entity.ticketIds, [ticketId]);
      assert.deepEqual(entity.clientIds, [oldClient, manual].sort());
      await assert.rejects(f.repo.execute({ type: "entity.tickets.update", scope, ticketIds: [ticketId, "missing"] }, actor));
      assert.deepEqual((await f.repo.entityDetail(actor, scope.kind, scope.id)).entity.ticketIds, [ticketId]);
    }
    const outsider = await addUser(f.repo, "global-ticket-editor");
    await f.repo.execute({ type: "ticket.update", id: ticketId, number: "00042", description: "Cambio global", url: null, clientId: nextClient }, outsider);
    assert.deepEqual((await f.repo.getWorkspace(outsider)).projects, []);
    for (const scope of f.scopes) {
      assert.deepEqual((await f.repo.entityDetail(actor, scope.kind, scope.id)).entity.clientIds, [oldClient, nextClient, manual].sort());
      await f.repo.execute({ type: "entity.clients.update", scope, clientIds: [manual] }, actor);
    }
    // Editing other fields does not undo an explicit client removal.
    await f.repo.execute({ type: "ticket.update", id: ticketId, number: "00042", description: "Otro cambio", url: null, clientId: nextClient }, actor);
    for (const scope of f.scopes) assert.deepEqual((await f.repo.entityDetail(actor, scope.kind, scope.id)).entity.clientIds, [manual]);
    await assert.rejects(f.repo.execute({ type: "ticket.delete", id: ticketId }, actor), { status: 409 });
    await assert.rejects(f.repo.execute({ type: "client.delete", id: nextClient }, actor), { status: 409 });
    for (const scope of f.scopes) {
      await f.repo.execute({ type: "entity.tickets.update", scope, ticketIds: [] }, actor);
      assert.deepEqual((await f.repo.entityDetail(actor, scope.kind, scope.id)).entity.clientIds, [manual]);
    }
    await f.repo.execute({ type: "ticket.delete", id: ticketId }, actor);
    await f.repo.execute({ type: "client.delete", id: nextClient }, actor);
    await f.repo.execute({ type: "project.delete", id: f.projectId }, actor);
    await f.repo.execute({ type: "client.delete", id: manual }, actor);
    await assertIntegrity(f.repo);
  } finally { await f.repo.close(); }
});

test("permisos, creación/asignación conjunta y creación de tarea con tickets son atómicos", async () => {
  const f = await fixture();
  try {
    const reader = await addUser(f.repo, "relations-reader");
    await f.repo.execute({ type: "project.team.add", projectId: f.projectId, userId: reader.id }, actor);
    const clientId = await f.client("Cliente"), ticketId = await f.ticket("R-1", clientId);
    for (const scope of f.scopes) {
      await assert.rejects(f.repo.execute({ type: "entity.clients.update", scope, clientIds: [clientId] }, reader), { status: scope.kind === "task" ? 404 : 403 });
      await assert.rejects(f.repo.execute({ type: "ticket.create", number: "Sin permiso", description: "", url: null, clientId, scope }, reader));
      await assert.rejects(f.repo.execute({ type: "entity.tickets.update", scope: { ...scope, projectId: "wrong" }, ticketIds: [ticketId] }, actor), { status: 404 });
    }
    assert.equal((await f.repo.getWorkspace(actor)).tickets.length, 1);
    const created = await f.ticket("R-2", clientId, f.scopes[1]);
    assert.deepEqual((await f.repo.entityDetail(actor, "module", f.moduleId)).entity.ticketIds, [created]);
    assert.deepEqual((await f.repo.entityDetail(actor, "module", f.moduleId)).entity.clientIds, [clientId]);
    const taskId = (await f.repo.execute({ type: "task.create", ...f.fields, ticketIds: [ticketId, ticketId] }, actor)).createdId!;
    const task = (await f.repo.getWorkspace(actor)).tasks.find((task) => task.id === taskId)!;
    assert.deepEqual(task.ticketIds, [ticketId]); assert.deepEqual(task.clientIds, [clientId]);
    const before = (await f.repo.getWorkspace(actor)).tasks.length;
    await assert.rejects(f.repo.execute({ type: "task.create", ...f.fields, ticketIds: ["missing"] }, actor));
    assert.equal((await f.repo.getWorkspace(actor)).tasks.length, before);
    await assert.rejects(f.repo.execute({ type: "task.update", id: f.taskId, ...f.fields, ticketNumber: "old" } as unknown as Command, actor), { status: 409 });
  } finally { await f.repo.close(); }
});

test("migración 0012 y respaldos v10 convierten cada número sin fusionar ni inventar clientes", async () => {
  const f = await fixture(), directory = await mkdtemp(join(tmpdir(), "ticket-migration-"));
  try {
    const one = await f.client("Uno"), two = await f.client("Dos");
    const cases = [ { number: "001234", clients: [] }, { number: " 001234 ", clients: [one] }, { number: "ABC-00042", clients: [one, two] }, { number: "   ", clients: [two] } ];
    const taskIds: string[] = [];
    await f.repo.execute({ type: "task.delete", id: f.taskId }, actor);
    for (const value of cases) taskIds.push((await f.repo.execute({ type: "task.create", ...f.fields, clientIds: value.clients }, actor)).createdId!);
    const path = join(directory, "before.json"); await f.repo.exportBackup(path);
    const legacy = JSON.parse(await readFile(path, "utf8"));
    stripTicketTables(legacy.tables); legacy.version = 10;
    legacy.tables.tasks.forEach((task: { id: string; ticketNumber: string }) => { task.ticketNumber = cases[taskIds.indexOf(task.id)].number; });
    const normalized = validateApplicationBackup(legacy);
    assert.equal(normalized.version, 13); assert.equal(normalized.tables.tickets.length, 3);
    await removeTicketSchema(f.repo);
    for (const [index, id] of taskIds.entries()) await f.repo.store.pool.query('update tasks set "ticketNumber" = $1 where id = $2', [cases[index].number, id]);
    await f.repo.store.pool.query(await readFile("drizzle/postgresql/0012_clients_tickets.sql", "utf8"));
    await f.repo.store.pool.query(await readFile("drizzle/postgresql/0014_oauth_mcp.sql", "utf8"));
    await f.repo.store.pool.query(await readFile("drizzle/postgresql/0015_applications.sql", "utf8"));
    const workspace = await f.repo.getWorkspace(actor);
    assert.equal(workspace.tickets.length, 3);
    for (const [index, id] of taskIds.entries()) {
      const task = workspace.tasks.find((task) => task.id === id)!;
      assert.deepEqual(task.clientIds, cases[index].clients.sort());
      assert.equal(task.ticketIds.length, index === 3 ? 0 : 1);
      if (index === 3) continue;
      const ticket = workspace.tickets.find((ticket) => ticket.id === task.ticketIds[0])!;
      assert.equal(ticket.number, cases[index].number.trim());
      assert.equal(ticket.clientId, index === 1 ? one : null);
      assert.deepEqual(normalized.tables.tickets.find((row) => row.id === ticket.id), ticket);
    }
    await migrate(drizzle(f.repo.store.pool), { migrationsFolder: migrationsFolder(), migrationsSchema: f.repo.store.schemaName });
    assert.deepEqual(await f.repo.getWorkspace(actor), workspace);
    await f.repo.exportBackup(join(directory, "after.json"));
    const current = JSON.parse(await readFile(join(directory, "after.json"), "utf8"));
    assert.equal(current.version, 13); assert.equal("ticketNumber" in current.tables.tasks[0], false);
    const bad = structuredClone(current); bad.tables.task_tickets[0].ticketId = "missing";
    assert.throws(() => validateApplicationBackup(bad));
    await f.repo.restoreBackup(join(directory, "after.json")); assert.deepEqual(await f.repo.getWorkspace(actor), workspace);
    await assertIntegrity(f.repo);
  } finally { await f.repo.close(); await rm(directory, { recursive: true, force: true }); }
});

test("!tickets conserva referencias Markdown sin confundir imágenes, código, URLs o duplicados", () => {
  const ref = { type: "ticket" as const, id: "ticket/con espacio" };
  assert.deepEqual(mentionQuery("Ver !00042"), { type: "ticket", query: "00042", start: 4 });
  for (const value of ["https://example.com/!00042", "www.example.com/!00042", "![imagen]", "abc!00042"]) assert.equal(mentionQuery(value), null);
  assert.deepEqual(parseMention("/mentions/tickets/ticket%2Fcon%20espacio"), ref);
  const manager = new MarkdownManager({ extensions: [StarterKit, Mention, Image], marked: createMarkdownParser() });
  const source = `${mentionMarkdown(ref, "00042 [QA]")} y ${mentionMarkdown({ type: "ticket", id: "otro" }, "00042")}\n\n\`${mentionMarkdown(ref, "ejemplo")}\`\n\n![Imagen](/mentions/tickets/falso)`;
  const parsed = manager.parse(source), saved = manager.serialize(parsed);
  assert.deepEqual(manager.parse(saved), parsed);
  assert.deepEqual(contentMentions(saved), [ref, { type: "ticket", id: "otro" }]);
});

test("respaldo v11 conserva todas las relaciones y rechaza vínculos huérfanos o repetidos", async () => {
  const f = await fixture(), directory = await mkdtemp(join(tmpdir(), "ticket-relations-backup-"));
  try {
    const clientId = await f.client("Cliente del respaldo"), ticketId = await f.ticket("B-001", clientId);
    for (const scope of f.scopes) await f.repo.execute({ type: "entity.tickets.update", scope, ticketIds: [ticketId] }, actor);
    const before = await f.repo.getWorkspace(actor), path = join(directory, "all.json");
    await f.repo.exportBackup(path);
    const backup = JSON.parse(await readFile(path, "utf8"));
    for (const scope of f.scopes) for (const item of ["client", "ticket"]) {
      const table = `${scope.kind}_${item}s`;
      assert.equal(backup.tables[table].length, 1);
      for (const key of [`${scope.kind}Id`, `${item}Id`]) {
        const invalid = structuredClone(backup); invalid.tables[table][0][key] = "missing";
        assert.throws(() => validateApplicationBackup(invalid));
      }
      const repeated = structuredClone(backup); repeated.tables[table].push({ ...repeated.tables[table][0] });
      assert.throws(() => validateApplicationBackup(repeated));
    }
    const unsafe = structuredClone(backup); unsafe.tables.tickets[0].url = "javascript:alert(1)";
    assert.throws(() => validateApplicationBackup(unsafe));
    await f.repo.execute({ type: "project.delete", id: f.projectId }, actor);
    await f.repo.execute({ type: "ticket.delete", id: ticketId }, actor);
    await f.repo.execute({ type: "client.delete", id: clientId }, actor);
    await f.repo.restoreBackup(path);
    assert.deepEqual(await f.repo.getWorkspace(actor), before);
    await assertIntegrity(f.repo);
  } finally { await f.repo.close(); await rm(directory, { recursive: true, force: true }); }
});

test("mencionar tickets en comentarios, descripciones y documentos no asigna ni notifica", async () => {
  const f = await fixture();
  try {
    const clientId = await f.client("Cliente mencionado"), ticketId = await f.ticket("M-001", clientId);
    const content = mentionMarkdown({ type: "ticket", id: ticketId }, "M-001");
    const service = new MentionsService(f.repo), docs = new DocumentsService(f.repo);
    for (const scope of f.scopes) {
      assert.ok((await service.options(actor, { scope })).tickets.some((ticket) => ticket.id === ticketId));
      await f.repo.execute({ type: "comment.create", scope, content }, actor);
      const detail = await f.repo.entityDetail(actor, scope.kind, scope.id);
      const update = { ...detail.entity, ...f.fields, id: scope.id, description: content, name: "Mencionado", type: `${scope.kind}.update`, icon: "M", color: "#059669", moduleId: f.moduleId } as Command;
      await f.repo.execute(update, actor);
      await docs.create(actor, scope.kind, scope.id, { title: "Referencia", description: "", content });
      const entity = (await f.repo.entityDetail(actor, scope.kind, scope.id)).entity;
      assert.deepEqual(entity.ticketIds, []); assert.deepEqual(entity.clientIds, []);
    }
    assert.equal((await f.repo.notifications.list(actor)).items.length, 0);
    const commentId = (await f.repo.execute({ type: "comment.create", scope: f.scopes[0], content }, actor)).createdId!;
    await f.repo.execute({ type: "ticket.delete", id: ticketId }, actor);
    await f.repo.execute({ type: "comment.update", id: commentId, content: content + " histórico" }, actor);
    await assert.rejects(f.repo.execute({ type: "comment.create", scope: f.scopes[0], content }, actor), /mención ya no está disponible/);
    assert.deepEqual((await service.options(actor, { scope: f.scopes[0] })).tickets, []);
  } finally { await f.repo.close(); }
});
