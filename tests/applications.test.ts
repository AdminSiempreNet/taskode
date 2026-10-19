import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { actor, addUser, assertIntegrity, createRepository } from "./helpers";
import { stripApplicationTables } from "./entity-fixtures";
import { DEFAULT_APPLICATIONS } from "../src/lib/types";
import { commandSchema } from "../src/lib/validation";
import { validateApplicationBackup } from "../src/server/backup-data";
import { matchesTaskFilters, UNASSIGNED_FILTER } from "../src/lib/task-filters";
import { searchTasks } from "../src/server/mcp/search";

async function fixture() {
  const repo = await createRepository();
  const projectId = (await repo.execute({ type: "project.create", name: "Aplicaciones", icon: "A", color: "#3b82f6", description: "" }, actor)).createdId!;
  const moduleId = (await repo.execute({ type: "module.create", projectId, name: "Módulo", description: "" }, actor)).createdId!;
  const featureId = (await repo.execute({ type: "feature.create", projectId, moduleId, name: "Feature", description: "" }, actor)).createdId!;
  const w = await repo.getWorkspace(actor);
  const fields = { projectId, featureId, title: "Nueva", description: "", statusId: w.statuses[0].id, priority: "medium", dueDate: null, labels: [] };
  return { repo, projectId, moduleId, featureId, fields, web: w.applications.find(a => a.isDefault)!, android: w.applications.find(a => a.name === "Android")! };
}

test("aplicaciones: catálogo, valores iniciales, selección independiente y actualización sin pérdida", async () => {
  const f = await fixture();
  try {
    const w = await f.repo.getWorkspace(actor);
    assert.deepEqual(w.applications.map(({ name, color, isDefault }) => ({ name, color, isDefault })), [...DEFAULT_APPLICATIONS]);
    const id = (await f.repo.execute({ type: "task.create", ...f.fields }, actor)).createdId!;
    const scope = { kind: "task" as const, id, projectId: f.projectId };
    assert.deepEqual(((await f.repo.entityDetail(actor, "task", id)).entity as { applicationIds: string[] }).applicationIds, [f.web.id]);
    assert.deepEqual((await f.repo.getWorkspace(actor)).tasks[0].applicationIds, [f.web.id]);
    await f.repo.execute({ type: "application.update", id: f.web.id, projectId: f.projectId, name: "Navegador", color: "#123456" }, actor);
    assert.deepEqual((await f.repo.getWorkspace(actor)).tasks[0].applicationIds, [f.web.id]);
    const second = (await f.repo.execute({ type: "task.create", ...f.fields }, actor)).createdId!;
    assert.deepEqual((await f.repo.getWorkspace(actor)).tasks.find(t => t.id === second)!.applicationIds, [f.web.id]);
    for (const [kind, entityId] of [["module", f.moduleId], ["feature", f.featureId], ["task", id]] as const)
      await f.repo.execute({ type: "entity.applications.update", scope: { kind, id: entityId, projectId: f.projectId }, applicationIds: [f.android.id, f.android.id] }, actor);
    assert.deepEqual((await f.repo.getWorkspace(actor)).tasks.find(t => t.id === second)!.applicationIds, [f.web.id], "sin propagación");
    await f.repo.execute({ type: "task.update", id, ...f.fields, title: "Editada" }, actor);
    assert.deepEqual((await f.repo.getWorkspace(actor)).tasks.find(t => t.id === id)!.applicationIds, [f.android.id]);
    await f.repo.execute({ type: "entity.applications.update", scope, applicationIds: [] }, actor);
    assert.deepEqual((await f.repo.getWorkspace(actor)).tasks.find(t => t.id === id)!.applicationIds, []);
    const empty = (await f.repo.execute({ type: "task.create", ...f.fields, applicationIds: [] }, actor)).createdId!;
    assert.deepEqual((await f.repo.getWorkspace(actor)).tasks.find(t => t.id === empty)!.applicationIds, []);
    await assert.rejects(f.repo.execute({ type: "application.delete", id: f.web.id, projectId: f.projectId }, actor), /predeterminada/);
    assert.equal(commandSchema.safeParse({ type: "entity.applications.update", scope: { kind: "project", id: f.projectId, projectId: f.projectId }, applicationIds: [] }).success, false);
    await assertIntegrity(f.repo);
  } finally { await f.repo.close(); }
});

test("aplicaciones: permisos, proyecto, eliminación protegida y limpieza en cascada", async () => {
  const f = await fixture();
  try {
    const member = await addUser(f.repo, "app-member"), outsider = await addUser(f.repo, "app-outsider");
    await f.repo.execute({ type: "project.team.add", projectId: f.projectId, userId: member.id }, actor);
    await assert.rejects(f.repo.execute({ type: "application.create", projectId: f.projectId, name: "Linux", color: "#123456" }, member));
    await assert.rejects(f.repo.getWorkspace(outsider).then(w => { assert.equal(w.applications.length, 0); return f.repo.entityDetail(outsider, "feature", f.featureId); }));
    const otherProject = (await f.repo.execute({ type: "project.create", name: "Otro", description: "", icon: "O", color: "#123456" }, actor)).createdId!;
    const foreign = (await f.repo.getWorkspace(actor)).applications.find(a => a.projectId === otherProject)!;
    await assert.rejects(f.repo.execute({ type: "task.create", ...f.fields, applicationIds: [foreign.id] }, actor), /pertenecer/);
    assert.equal((await f.repo.getWorkspace(actor)).tasks.length, 0, "rollback de creación inválida");
    const id = (await f.repo.execute({ type: "task.create", ...f.fields, applicationIds: [f.android.id] }, actor)).createdId!;
    await assert.rejects(f.repo.execute({ type: "entity.applications.update", scope: { kind: "task", id, projectId: f.projectId }, applicationIds: [] }, member), /permiso|acceso/);
    await f.repo.execute({ type: "task.archive", id, archived: true }, actor);
    await assert.rejects(f.repo.execute({ type: "application.delete", id: f.android.id, projectId: f.projectId }, actor), /archivadas/);
    await assert.rejects(f.repo.execute({ type: "application.create", projectId: f.projectId, name: "android", color: "#123456" }, actor), /Ya existe/);
    await f.repo.execute({ type: "task.delete", id }, actor);
    await f.repo.execute({ type: "application.delete", id: f.android.id, projectId: f.projectId }, actor);
    await f.repo.execute({ type: "project.delete", id: f.projectId }, actor);
    assert.equal((await f.repo.getWorkspace(actor)).applications.some(a => a.projectId === f.projectId), false);
  } finally { await f.repo.close(); }
});

test("aplicaciones: importación Trello y filtros OR/AND equivalentes en interfaz y MCP", async () => {
  const f = await fixture();
  try {
    await f.repo.execute({ type: "trello.import", projectId: f.projectId, board: { name: "Trello", lists: [{ id: "l", name: "Lista", closed: false }], cards: [{ id: "c", idList: "l", name: "Importada", desc: "", closed: false, labels: [] }] } }, actor);
    await f.repo.execute({ type: "task.create", ...f.fields, title: "Android", applicationIds: [f.android.id] }, actor);
    await f.repo.execute({ type: "task.create", ...f.fields, title: "Vacía", applicationIds: [] }, actor);
    const w = await f.repo.getWorkspace(actor);
    assert.deepEqual(w.tasks.find(t => t.title === "Importada")!.applicationIds, [f.web.id]);
    for (const applicationIds of [[], [f.web.id], [f.web.id, f.android.id], [UNASSIGNED_FILTER], [f.web.id, UNASSIGNED_FILTER]]) {
      const direct = w.tasks.filter(t => matchesTaskFilters(t, { statusIds: [], typeIds: [], impactIds: [], applicationIds }));
      assert.deepEqual(searchTasks(w, { applicationIds, sort: "position" }, actor.id).tasks.map(t => t.id).sort(), direct.map(t => t.id).sort());
    }
    assert.equal(searchTasks(w, { applicationIds: [f.android.id], query: "Importada" }, actor.id).total, 0);
    assert.equal(searchTasks(w, { applicationIds: [f.web.id, f.android.id] }, actor.id).total, 2);
    assert.equal(searchTasks(w, { applicationIds: [UNASSIGNED_FILTER] }, actor.id).total, 1);
  } finally { await f.repo.close(); }
});

test("aplicaciones: migración 0015 y respaldo v13/v12 conservan reglas y rechazan referencias ajenas", async () => {
  const f = await fixture(), directory = await mkdtemp(join(tmpdir(), "taskode-applications-"));
  try {
    const taskId = (await f.repo.execute({ type: "task.create", ...f.fields, applicationIds: [] }, actor)).createdId!;
    await f.repo.execute({ type: "task.archive", id: taskId, archived: true }, actor);
    await f.repo.execute({ type: "entity.applications.update", scope: { kind: "module", id: f.moduleId, projectId: f.projectId }, applicationIds: [f.android.id] }, actor);
    const path = join(directory, "backup.json");
    await f.repo.exportBackup(path);
    const current = JSON.parse(await readFile(path, "utf8"));
    assert.equal(current.version, 13);
    assert.equal(validateApplicationBackup(current).tables.task_applications.length, 0);
    const before = await f.repo.getWorkspace(actor);
    await f.repo.restoreBackup(path);
    assert.deepEqual(await f.repo.getWorkspace(actor), before);
    const repeated = structuredClone(current); repeated.tables.module_applications.push({ ...repeated.tables.module_applications[0] });
    assert.throws(() => validateApplicationBackup(repeated));
    const noDefault = structuredClone(current); noDefault.tables.applications.forEach((a: { isDefault: boolean }) => a.isDefault = false);
    assert.throws(() => validateApplicationBackup(noDefault));
    const foreign = structuredClone(current);
    foreign.tables.projects.push({ ...foreign.tables.projects[0], id: "foreign" });
    const foreignApps = foreign.tables.applications.map((app: { id: string; projectId: string }) => ({ ...app, id: `foreign:${app.id}`, projectId: "foreign" }));
    foreign.tables.applications.push(...foreignApps);
    foreign.tables.module_applications[0].applicationId = `foreign:${f.android.id}`;
    assert.throws(() => validateApplicationBackup(foreign), /otro proyecto/);
    const legacy = structuredClone(current); stripApplicationTables(legacy.tables); legacy.version = 12;
    const converted = validateApplicationBackup(legacy);
    assert.equal(converted.tables.applications.length, 5);
    assert.equal(converted.tables.task_applications.length, 1);
    await writeFile(path, JSON.stringify(legacy)); await f.repo.restoreBackup(path);
    assert.equal((await f.repo.getWorkspace(actor)).tasks[0].applicationIds.length, 1);
    await f.repo.store.pool.query("drop table task_applications, feature_applications, module_applications, applications");
    await f.repo.store.pool.query(await readFile("drizzle/postgresql/0015_applications.sql", "utf8"));
    const migrated = await f.repo.getWorkspace(actor);
    assert.deepEqual(migrated.tasks[0].applicationIds, [migrated.applications.find(a => a.isDefault)!.id]);
    assert.equal(migrated.tasks[0].archived, true);
    await assertIntegrity(f.repo);
  } finally { await f.repo.close(); await rm(directory, { recursive: true, force: true }); }
});
