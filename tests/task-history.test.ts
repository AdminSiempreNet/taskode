import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SqliteRepository } from "../src/server/sqlite";

function setup(path = ":memory:") {
  const repo = new SqliteRepository(path, false);
  const projectId = repo.execute({
    type: "project.create",
    name: "Historial",
    description: "",
    icon: "🌱",
    color: "#059669",
  }).createdId!;
  const workspace = repo.getWorkspace();
  const fields = {
    projectId,
    featureId: workspace.features[0].id,
    statusId: workspace.statuses[0].id,
    title: "Una tarea",
    description: "",
    priority: "medium",
    dueDate: null,
    labels: [],
  };
  const id = repo.execute({ type: "task.create", ...fields }).createdId!;
  return { repo, projectId, id, fields, statuses: workspace.statuses };
}

test("el historial registra cambios del detalle y del tablero, sin duplicar al guardar o reordenar", () => {
  const { repo, id, fields, statuses } = setup();
  try {
    assert.deepEqual(repo.getWorkspace().tasks[0].statusHistory, []);
    repo.execute({
      type: "task.update",
      id,
      ...fields,
      statusId: statuses[1].id,
    });
    const first = repo.getWorkspace().tasks[0].statusHistory[0];
    assert.deepEqual(
      [
        first.fromStatusId,
        first.fromStatusName,
        first.toStatusId,
        first.toStatusName,
      ],
      [statuses[0].id, statuses[0].name, statuses[1].id, statuses[1].name],
    );
    assert.equal(first.changedAt, repo.getWorkspace().tasks[0].updatedAt);
    repo.execute({
      type: "task.update",
      id,
      ...fields,
      statusId: statuses[1].id,
      description: "Solo texto",
    });
    repo.execute({
      type: "task.move",
      id,
      statusId: statuses[1].id,
      beforeId: null,
    });
    assert.deepEqual(repo.getWorkspace().tasks[0].statusHistory, [first]);
    repo.execute({
      type: "task.move",
      id,
      statusId: statuses[2].id,
      beforeId: null,
    });
    const history = repo.getWorkspace().tasks[0].statusHistory;
    assert.equal(history.length, 2);
    assert.ok(history[0].id > history[1].id);
    assert.deepEqual(
      [history[0].fromStatusId, history[0].toStatusId],
      [statuses[1].id, statuses[2].id],
    );
    repo.execute({ type: "task.archive", id, archived: true });
    assert.deepEqual(repo.getWorkspace().tasks[0].statusHistory, history);
    repo.execute({ type: "task.archive", id, archived: false });
    repo.execute({ type: "task.rename", id, title: "Renombrada" });
    assert.deepEqual(repo.getWorkspace().tasks[0].statusHistory, history);
  } finally {
    repo.close();
  }
});

test("los cambios rechazados no añaden historial ni modifican la tarea", () => {
  const { repo, id, fields, statuses } = setup();
  try {
    const otherProject = repo.execute({
      type: "project.create",
      name: "Otro",
      description: "",
      icon: "🌱",
      color: "#059669",
    }).createdId!;
    const foreignStatus = repo
      .getWorkspace()
      .statuses.find((status) => status.projectId === otherProject)!.id;
    const before = repo.getWorkspace();
    assert.throws(
      () =>
        repo.execute({
          type: "task.update",
          id,
          ...fields,
          statusId: foreignStatus,
        }),
      /pertenecer/,
    );
    assert.throws(
      () =>
        repo.execute({
          type: "task.move",
          id,
          statusId: foreignStatus,
          beforeId: null,
        }),
      /otro proyecto/,
    );
    assert.throws(
      () =>
        repo.execute({
          type: "task.move",
          id,
          statusId: statuses[1].id,
          beforeId: "inexistente",
        }),
      /destino/,
    );
    assert.throws(
      () =>
        repo.execute({
          type: "task.update",
          id,
          ...fields,
          statusId: statuses[1].id,
          priority: "inexistente",
        }),
      /prioridad/,
    );
    assert.deepEqual(repo.getWorkspace(), before);
  } finally {
    repo.close();
  }
});

test("el historial conserva nombres y colores históricos, persiste en respaldo y se elimina con la tarea", async () => {
  const dir = await mkdtemp(join(tmpdir(), "brote-history-"));
  const path = join(dir, "workspace.sqlite");
  let { repo, id, statuses } = setup(path);
  try {
    repo.execute({
      type: "task.move",
      id,
      statusId: statuses[1].id,
      beforeId: null,
    });
    const history = repo.getWorkspace().tasks[0].statusHistory;
    repo.execute({
      type: "status.update",
      id: statuses[0].id,
      name: "Renombrado",
      color: "#ffffff",
      isDone: false,
    });
    repo.execute({ type: "status.delete", id: statuses[0].id });
    assert.deepEqual(repo.getWorkspace().tasks[0].statusHistory, history);
    assert.equal(history[0].fromStatusColor, statuses[0].color);
    const snapshot = repo.getWorkspace();
    const backupPath = join(dir, "backup.sqlite");
    await repo.exportBackup(backupPath);
    repo.close();
    repo = new SqliteRepository(path, false);
    assert.deepEqual(repo.getWorkspace(), snapshot);
    const restored = new SqliteRepository(backupPath, false);
    try {
      assert.deepEqual(restored.getWorkspace(), snapshot);
    } finally {
      restored.close();
    }
    repo.execute({ type: "task.delete", id });
    assert.equal(
      repo.db.prepare("SELECT COUNT(*) AS n FROM task_status_history").get()?.n,
      0,
    );
    assert.deepEqual(repo.db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    repo.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("la migración v5 une checklists sin perder ítems, orden ni completados y exige una lista por tarea", async () => {
  const dir = await mkdtemp(join(tmpdir(), "brote-single-checklist-"));
  const path = join(dir, "workspace.sqlite");
  let { repo, id } = setup(path);
  try {
    const firstId = repo.execute({
      type: "checklist.create",
      taskId: id,
      title: "Primera lista",
    }).createdId!;
    const itemId = repo.execute({
      type: "checklist.item.create",
      checklistId: firstId,
      title: "Ya completado",
    }).createdId!;
    repo.execute({
      type: "checklist.item.update",
      id: itemId,
      title: "Ya completado",
      completed: true,
    });
    repo.execute({ type: "task.archive", id, archived: true });
    const original = repo.getWorkspace();
    repo.close();
    const legacy = new DatabaseSync(path);
    legacy.exec(
      "DROP TABLE task_status_history; DROP INDEX checklist_task; CREATE INDEX checklist_task ON checklists(taskId); DROP INDEX feature_number; ALTER TABLE features DROP COLUMN number; PRAGMA user_version=5;",
    );
    legacy
      .prepare(
        "INSERT INTO checklists (id,taskId,title,position) VALUES (?,?,?,?)",
      )
      .run("second-list", id, "Segunda lista", 1);
    legacy
      .prepare(
        "INSERT INTO checklist_items (id,checklistId,title,completed,position) VALUES (?,?,?,?,?)",
      )
      .run("legacy-item-b", "second-list", "Otro paso", 0, 0);
    legacy
      .prepare(
        "INSERT INTO checklist_items (id,checklistId,title,completed,position) VALUES (?,?,?,?,?)",
      )
      .run("legacy-item-c", "second-list", "Último paso", 1, 1);
    legacy.close();
    repo = new SqliteRepository(path, false);
    const saved = repo.getWorkspace();
    assert.equal(saved.tasks[0].checklists.length, 1);
    assert.equal(saved.tasks[0].checklists[0].id, firstId);
    assert.equal(saved.tasks[0].checklists[0].title, "Primera lista");
    assert.deepEqual(
      saved.tasks[0].checklists[0].items.map((item) => [
        item.id,
        item.title,
        item.completed,
        item.position,
      ]),
      [
        [itemId, "Ya completado", true, 0],
        ["legacy-item-b", "Otro paso", false, 1],
        ["legacy-item-c", "Último paso", true, 2],
      ],
    );
    assert.deepEqual(saved.tasks[0].statusHistory, []);
    assert.equal(saved.tasks[0].archived, original.tasks[0].archived);
    assert.deepEqual(saved.projects, original.projects);
    assert.throws(
      () =>
        repo.execute({
          type: "checklist.create",
          taskId: id,
          title: "Duplicada",
        }),
      /ya tiene un checklist/,
    );
    assert.throws(
      () =>
        repo.db
          .prepare(
            "INSERT INTO checklists (id,taskId,title,position) VALUES (?,?,?,?)",
          )
          .run("duplicate", id, "Duplicada", 1),
      /UNIQUE/,
    );
    assert.deepEqual(repo.db.prepare("PRAGMA foreign_key_check").all(), []);
    repo.close();
    repo = new SqliteRepository(path, false);
    assert.deepEqual(repo.getWorkspace(), saved);
    repo.execute({ type: "checklist.delete", id: firstId });
    assert.equal(repo.getWorkspace().tasks[0].checklists.length, 0);
    assert.ok(
      repo.execute({
        type: "checklist.create",
        taskId: id,
        title: "Nueva lista única",
      }).createdId,
    );
  } finally {
    repo.close();
    await rm(dir, { recursive: true, force: true });
  }
});
