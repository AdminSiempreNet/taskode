import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SqliteRepository } from "../src/server/sqlite";
import {
  commandSchema,
  trelloSchema,
  type Command,
} from "../src/lib/validation";

// Recreate the actual legacy task schema so migration tests exercise old databases,
// rather than only changing user_version on a database with the new tables.
function downgradeToV3(db: DatabaseSync) {
  db.exec(`
    PRAGMA foreign_keys=OFF;
    DROP TABLE task_status_history;
    DROP INDEX feature_number;
    ALTER TABLE features DROP COLUMN number;
    DROP INDEX feature_module;
    ALTER TABLE features DROP COLUMN moduleId;
    DROP TABLE modules;
    DROP TABLE checklist_items; DROP TABLE checklists; DROP TABLE comments;
    CREATE TABLE tasks_legacy (id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, featureId TEXT NOT NULL, statusId TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, priority TEXT NOT NULL CHECK(priority IN ('low','medium','high')), dueDate TEXT, archived INTEGER NOT NULL DEFAULT 0, position REAL NOT NULL, labels TEXT NOT NULL DEFAULT '[]', externalId TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, dueTime TEXT,
      FOREIGN KEY(featureId,projectId) REFERENCES features(id,projectId) ON DELETE CASCADE,
      FOREIGN KEY(statusId,projectId) REFERENCES statuses(id,projectId), UNIQUE(projectId,externalId));
    INSERT INTO tasks_legacy SELECT id,projectId,featureId,statusId,title,description,priority,dueDate,archived,position,labels,externalId,createdAt,updatedAt,dueTime FROM tasks;
    DROP TABLE tasks; ALTER TABLE tasks_legacy RENAME TO tasks;
    DROP TABLE priorities; DROP TABLE labels;
    CREATE INDEX task_project ON tasks(projectId,archived);
    CREATE INDEX task_feature ON tasks(featureId);
    CREATE INDEX task_status ON tasks(statusId);
    PRAGMA user_version=3;
  `);
}

function setup() {
  const repo = new SqliteRepository(":memory:", false);
  const projectId = repo.execute({
    type: "project.create",
    name: "Proyecto A",
    description: "Pruebas",
    icon: "🌱",
    color: "#059669",
  }).createdId!;
  const w = repo.getWorkspace();
  const task = {
    type: "task.create",
    projectId,
    featureId: w.features[0].id,
    statusId: w.statuses[0].id,
    title: "Una tarea",
    description: "Detalle",
    priority: "medium",
    dueDate: "2026-10-15",
    labels: ["Prueba"],
  } satisfies Command;
  return { repo, projectId, task };
}

test("crear y editar proyectos conserva emojis compuestos del selector", () => {
  const repo = new SqliteRepository(":memory:", false);
  const fields = { name: "Emojis", description: "", color: "#059669" };
  const england = String.fromCodePoint(
    0x1f3f4, 0xe0067, 0xe0062, 0xe0065, 0xe006e, 0xe0067, 0xe007f,
  );
  try {
    const id = repo.execute(
      commandSchema.parse({ type: "project.create", ...fields, icon: england }),
    ).createdId!;
    assert.equal(repo.getWorkspace().projects[0].icon, england);

    const couple = "🧑🏽‍❤️‍💋‍🧑🏻";
    repo.execute(
      commandSchema.parse({ type: "project.update", id, ...fields, icon: couple }),
    );
    assert.equal(repo.getWorkspace().projects[0].icon, couple);
  } finally {
    repo.close();
  }
});

test("las prioridades son personalizables por proyecto y no se pueden borrar mientras estén en uso", () => {
  const { repo, projectId, task } = setup();
  try {
    const id = repo.execute({
      type: "priority.create",
      projectId,
      name: "Urgente",
      color: "#ef4444",
    }).createdId!;
    repo.execute({ ...task, priority: id });
    repo.execute({
      type: "priority.update",
      projectId,
      id,
      name: "Crítica",
      color: "#dc2626",
    });
    assert.equal(
      repo.getWorkspace().priorities.find((p) => p.id === id)?.name,
      "Crítica",
    );
    assert.throws(
      () => repo.execute({ type: "priority.delete", projectId, id }),
      /tareas/,
    );
    assert.throws(
      () => repo.execute({ ...task, priority: "no-existe" }),
      /prioridad/,
    );
    const other = repo.execute({
      type: "project.create",
      name: "Otro",
      description: "",
      icon: "📋",
      color: "#3b82f6",
    }).createdId!;
    assert.throws(
      () =>
        repo.execute({
          type: "priority.update",
          projectId: other,
          id,
          name: "Ajena",
          color: "#3b82f6",
        }),
      /no pertenece/,
    );
    repo.execute({ type: "task.delete", id: repo.getWorkspace().tasks[0].id });
    repo.execute({ type: "priority.delete", projectId, id });
    assert.equal(
      repo.getWorkspace().priorities.some((p) => p.id === id),
      false,
    );
  } finally {
    repo.close();
  }
});

test("renombrar y eliminar etiquetas actualiza también tareas archivadas y conserva otros proyectos", () => {
  const { repo, projectId, task } = setup();
  try {
    const taskId = repo.execute(task).createdId!;
    const label = repo.getWorkspace().labels[0];
    repo.execute({ type: "task.archive", id: taskId, archived: true });
    repo.execute({
      type: "label.update",
      projectId,
      id: label.id,
      name: "Diseño",
      color: "#8b5cf6",
    });
    assert.deepEqual(repo.getWorkspace().tasks[0].labels, ["Diseño"]);
    assert.equal(repo.getWorkspace().labels[0].color, "#8b5cf6");
    assert.throws(
      () =>
        repo.execute({
          type: "label.create",
          projectId,
          name: "diseño",
          color: "#3b82f6",
        }),
      /Ya existe/,
    );
    repo.execute({ ...task, labels: ["DISEÑO", "Diseño"] });
    assert.deepEqual(repo.getWorkspace().tasks[1].labels, ["Diseño"]);
    repo.execute({ type: "label.delete", projectId, id: label.id });
    assert.ok(repo.getWorkspace().tasks.every((t) => t.labels.length === 0));
    assert.deepEqual(repo.db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    repo.close();
  }
});

test("checklists y comentarios permiten editar, completar y borrar y se eliminan en cascada", () => {
  const { repo, task } = setup();
  try {
    const taskId = repo.execute(task).createdId!;
    const listId = repo.execute({
      type: "checklist.create",
      taskId,
      title: "Publicar",
    }).createdId!;
    const itemId = repo.execute({
      type: "checklist.item.create",
      checklistId: listId,
      title: "Revisar",
    }).createdId!;
    repo.execute({
      type: "checklist.item.update",
      id: itemId,
      title: "Revisar cambios",
      completed: true,
    });
    repo.execute({
      type: "checklist.update",
      id: listId,
      title: "Antes de publicar",
    });
    const commentId = repo.execute({
      type: "comment.create",
      taskId,
      content: "Primer avance",
    }).createdId!;
    repo.execute({
      type: "comment.update",
      id: commentId,
      content: "Listo para revisar",
    });
    const saved = repo.getWorkspace().tasks[0];
    assert.equal(saved.checklists[0].items[0].completed, true);
    assert.equal(saved.checklists[0].title, "Antes de publicar");
    assert.equal(saved.comments[0].content, "Listo para revisar");
    assert.equal(Object.getPrototypeOf(saved.comments[0]), Object.prototype);
    repo.execute({ type: "comment.delete", id: commentId });
    assert.equal(repo.getWorkspace().tasks[0].comments.length, 0);
    repo.execute({ type: "task.delete", id: taskId });
    for (const table of ["checklists", "checklist_items", "comments"])
      assert.equal(
        repo.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n,
        0,
      );
    assert.throws(
      () =>
        repo.execute({ type: "comment.create", taskId, content: "Huérfano" }),
      /ya no existe/,
    );
    assert.equal(
      commandSchema.safeParse({ type: "comment.create", taskId, content: "  " })
        .success,
      false,
    );
  } finally {
    repo.close();
  }
});

test("el inicio es opcional, persiste en clientes anteriores y el fin debe ser posterior", () => {
  const { repo, task } = setup();
  try {
    const id = repo.execute({
      ...task,
      startDate: "2026-10-15",
      startTime: "09:00",
      dueTime: "11:30",
    }).createdId!;
    assert.equal(repo.getWorkspace().tasks[0].startTime, "09:00");
    repo.execute({ ...task, type: "task.update", id });
    assert.equal(repo.getWorkspace().tasks[0].startTime, "09:00");
    for (const fields of [
      { startDate: "2026-10-16" },
      { startDate: "2026-10-15", startTime: "12:00", dueTime: "11:00" },
      { startDate: "2026-10-15", startTime: "11:00", dueTime: "11:00" },
    ]) {
      assert.throws(
        () => repo.execute({ ...task, ...fields }),
        /posterior al inicio/,
      );
    }
    assert.throws(() => repo.execute({ ...task, startTime: "09:00" }), /fecha/);
    assert.equal(
      commandSchema.safeParse({ ...task, startDate: "2026-02-30" }).success,
      false,
    );
    assert.equal(
      commandSchema.safeParse({ ...task, startTime: "24:00" }).success,
      false,
    );
    repo.execute({ ...task, type: "task.update", id, startDate: null });
    assert.equal(repo.getWorkspace().tasks[0].startTime, null);
    repo.execute({
      ...task,
      type: "task.update",
      id,
      startDate: "2026-10-20",
      startTime: "10:00",
      dueDate: null,
    });
    assert.equal(repo.getWorkspace().tasks[0].startDate, "2026-10-20");
  } finally {
    repo.close();
  }
});
test("CRUD persiste campos, estados, archivo y restauración", () => {
  const { repo, task } = setup();
  try {
    const id = repo.execute(task).createdId!;
    repo.execute({
      ...task,
      type: "task.update",
      id,
      title: "Actualizada",
      priority: "high",
    });
    repo.execute({ type: "task.archive", id, archived: true });
    assert.equal(repo.getWorkspace().tasks[0].archived, true);
    assert.equal(repo.getWorkspace().tasks[0].priority, "high");
    const beforeRename = repo.getWorkspace().tasks[0];
    repo.execute(
      commandSchema.parse({ type: "task.rename", id, title: "Título inline" }),
    );
    assert.equal(repo.getWorkspace().tasks[0].title, "Título inline");
    assert.equal(
      repo.getWorkspace().tasks[0].description,
      beforeRename.description,
    );
    assert.deepEqual(repo.getWorkspace().tasks[0].labels, beforeRename.labels);
    assert.equal(
      commandSchema.safeParse({ type: "task.rename", id, title: " " }).success,
      false,
    );
    repo.execute({ type: "task.archive", id, archived: false });
    assert.equal(repo.getWorkspace().tasks[0].archived, false);
    repo.execute({ type: "task.delete", id });
    assert.equal(repo.getWorkspace().tasks.length, 0);
  } finally {
    repo.close();
  }
});
test("las tareas no pueden cruzar los límites de un proyecto y el fallo revierte la transacción", () => {
  const { repo, task } = setup();
  try {
    const p = repo.execute({
      type: "project.create",
      name: "B",
      description: "",
      icon: "💡",
      color: "#059669",
    }).createdId!;
    const other = repo.getWorkspace().statuses.find((s) => s.projectId === p)!;
    assert.throws(
      () => repo.execute({ ...task, statusId: other.id }),
      /pertenecer al proyecto/,
    );
    assert.equal(repo.getWorkspace().tasks.length, 0);
    const id = repo.execute(task).createdId!;
    assert.throws(
      () =>
        repo.execute({
          type: "task.move",
          id,
          statusId: other.id,
          beforeId: null,
        }),
      /otro proyecto/,
    );
    assert.equal(repo.getWorkspace().tasks[0].statusId, task.statusId);
  } finally {
    repo.close();
  }
});
test("mover una tarea cambia la columna y mantiene un orden estable", () => {
  const { repo, task } = setup();
  try {
    const a = repo.execute({ ...task, title: "A" }).createdId!;
    const b = repo.execute({ ...task, title: "B" }).createdId!;
    const statusId = repo.getWorkspace().statuses[1].id;
    repo.execute({ type: "task.move", id: a, statusId, beforeId: null });
    repo.execute({ type: "task.move", id: b, statusId, beforeId: a });
    assert.deepEqual(
      repo
        .getWorkspace()
        .tasks.filter((t) => t.statusId === statusId)
        .map((t) => t.title),
      ["B", "A"],
    );
  } finally {
    repo.close();
  }
});
test("los estados con tareas archivadas no se eliminan ni puede eliminarse el último", () => {
  const { repo, task } = setup();
  try {
    const id = repo.execute(task).createdId!;
    repo.execute({ type: "task.archive", id, archived: true });
    assert.throws(
      () => repo.execute({ type: "status.delete", id: task.statusId }),
      /archivadas/,
    );
    repo
      .getWorkspace()
      .statuses.filter((s) => s.id !== task.statusId)
      .forEach((s) => repo.execute({ type: "status.delete", id: s.id }));
    assert.throws(
      () => repo.execute({ type: "status.delete", id: task.statusId }),
      /al menos un estado/,
    );
  } finally {
    repo.close();
  }
});
test("reordenar requiere exactamente los estados del proyecto", () => {
  const { repo, projectId } = setup();
  try {
    const ids = repo
      .getWorkspace()
      .statuses.map((s) => s.id)
      .reverse();
    repo.execute({ type: "status.reorder", projectId, ids });
    assert.deepEqual(
      repo.getWorkspace().statuses.map((s) => s.id),
      ids,
    );
    assert.throws(
      () =>
        repo.execute({
          type: "status.reorder",
          projectId,
          ids: [ids[0], ids[0], ids[1], ids[2]],
        }),
      /cambió/,
    );
    assert.deepEqual(
      repo.getWorkspace().statuses.map((s) => s.id),
      ids,
    );
    assert.throws(
      () =>
        repo.execute({
          type: "status.create",
          projectId,
          name: "pendiente",
          color: "#059669",
          isDone: false,
        }),
      /Ya existe/,
    );
  } finally {
    repo.close();
  }
});
test("borrar una feature o un proyecto elimina sus tareas sin dañar otros proyectos", () => {
  const { repo, projectId, task } = setup();
  try {
    repo.execute(task);
    repo.execute({ type: "feature.delete", id: task.featureId });
    assert.equal(repo.getWorkspace().tasks.length, 0);
    const other = repo.execute({
      type: "project.create",
      name: "B",
      description: "",
      icon: "💡",
      color: "#059669",
    }).createdId!;
    const featureId = repo.execute({
      type: "feature.create",
      projectId,
      name: "Nueva",
      description: "",
    }).createdId!;
    repo.execute({ ...task, featureId });
    repo.execute({ type: "project.delete", id: projectId });
    const w = repo.getWorkspace();
    assert.deepEqual(
      w.projects.map((p) => p.id),
      [other],
    );
    assert.equal(w.tasks.length, 0);
    assert.equal(w.statuses.length, 4);
    assert.deepEqual(repo.db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    repo.close();
  }
});
const board = trelloSchema.parse({
  name: "Tablero Trello",
  lists: [
    { id: "list1", name: "Por hacer" },
    { id: "list2", name: "Antiguas", closed: true },
  ],
  cards: [
    {
      id: "a",
      name: "Tarea Trello",
      idList: "list1",
      desc: "Descripción",
      due: "2026-10-15T12:00:00.000Z",
      labels: [{ name: "Diseño", color: "green" }],
    },
    { id: "b", name: "Archivada", idList: "list2" },
  ],
});
test("Trello importa fechas, etiquetas y archivo, y repetir la importación no duplica tarjetas ni features", () => {
  const { repo, projectId } = setup();
  try {
    assert.equal(
      repo.execute({ type: "trello.import", board, projectId }).report
        ?.imported,
      2,
    );
    const w = repo.getWorkspace();
    const t = w.tasks.find((t) => t.title === "Tarea Trello")!;
    assert.equal(t.dueDate, "2026-10-15");
    assert.deepEqual(t.labels, ["Diseño"]);
    assert.equal(t.description, "Descripción");
    assert.equal(w.tasks.find((t) => t.title === "Archivada")?.archived, true);
    const report = repo.execute({
      type: "trello.import",
      board,
      projectId,
    }).report!;
    assert.equal(report.imported, 0);
    assert.equal(report.skipped, 2);
    assert.equal(repo.getWorkspace().features.length, 2);
  } finally {
    repo.close();
  }
});
test("una importación inválida revierte incluso la creación del proyecto", () => {
  const { repo } = setup();
  try {
    assert.throws(
      () =>
        repo.execute({
          type: "trello.import",
          projectId: null,
          board: { ...board, cards: [board.cards[0], board.cards[0]] },
        }),
      /duplicados/,
    );
    assert.equal(repo.getWorkspace().projects.length, 1);
    assert.equal(repo.getWorkspace().tasks.length, 0);
  } finally {
    repo.close();
  }
});
test("validación rechaza fechas imposibles y títulos vacíos", () => {
  const { repo, task } = setup();
  try {
    assert.equal(
      commandSchema.safeParse({ ...task, dueDate: "2026-02-30" }).success,
      false,
    );
    assert.equal(
      commandSchema.safeParse({ ...task, title: "  " }).success,
      false,
    );
    assert.equal(
      commandSchema.safeParse({ ...task, priority: "" }).success,
      false,
    );
    assert.equal(
      trelloSchema.safeParse({
        ...board,
        cards: [{ ...board.cards[0], due: "no es una fecha" }],
      }).success,
      false,
    );
  } finally {
    repo.close();
  }
});
test("el respaldo incluye las escrituras WAL y puede abrirse como una base íntegra", async () => {
  const dir = await mkdtemp(join(tmpdir(), "brote-test-"));
  const repo = new SqliteRepository(join(dir, "source.sqlite"), false);
  try {
    const p = repo.execute({
      type: "project.create",
      name: "Persistente",
      description: "",
      icon: "🌱",
      color: "#059669",
    }).createdId!;
    await repo.exportBackup(join(dir, "backup.sqlite"));
    assert.equal(
      (await readFile(join(dir, "backup.sqlite"))).subarray(0, 16).toString(),
      "SQLite format 3\0",
    );
    const copy = new SqliteRepository(join(dir, "backup.sqlite"), false);
    try {
      assert.equal(copy.getWorkspace().projects[0].id, p);
      assert.equal(
        copy.db.prepare("PRAGMA integrity_check").get()?.integrity_check,
        "ok",
      );
    } finally {
      copy.close();
    }
  } finally {
    repo.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("los datos persisten al reiniciar y un espacio vacío no se vuelve a sembrar", async () => {
  const dir = await mkdtemp(join(tmpdir(), "brote-persist-"));
  const path = join(dir, "data.sqlite");
  let repo = new SqliteRepository(path);
  try {
    const first = repo.getWorkspace();
    assert.equal(first.projects.length, 1);
    assert.equal(first.tasks.length, 5);
    repo.close();
    repo = new SqliteRepository(path);
    assert.deepEqual(repo.getWorkspace(), first);
    repo.execute({ type: "project.delete", id: first.projects[0].id });
    repo.close();
    repo = new SqliteRepository(path);
    assert.equal(repo.getWorkspace().projects.length, 0);
  } finally {
    repo.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("fijar features respeta el máximo de cinco por proyecto y permite liberar una plaza", () => {
  const { repo, projectId } = setup();
  try {
    for (let i = 0; i < 5; i++)
      repo.execute({
        type: "feature.create",
        projectId,
        name: `Feature ${i}`,
        description: "",
      });
    const features = repo.getWorkspace().features;
    for (const feature of features.slice(0, 5))
      repo.execute({ type: "feature.pin", id: feature.id, pinned: true });
    assert.throws(
      () =>
        repo.execute({ type: "feature.pin", id: features[5].id, pinned: true }),
      /máximo de 5/,
    );
    assert.equal(
      repo.getWorkspace().features.filter((feature) => feature.pinned).length,
      5,
    );
    repo.execute({ type: "feature.pin", id: features[0].id, pinned: true });
    repo.execute({ type: "feature.pin", id: features[0].id, pinned: false });
    repo.execute({ type: "feature.pin", id: features[5].id, pinned: true });
    const other = repo.execute({
      type: "project.create",
      name: "Otro proyecto",
      description: "",
      icon: "💡",
      color: "#059669",
    }).createdId!;
    const otherFeature = repo
      .getWorkspace()
      .features.find((feature) => feature.projectId === other)!;
    repo.execute({ type: "feature.pin", id: otherFeature.id, pinned: true });
    assert.equal(
      repo
        .getWorkspace()
        .features.filter(
          (feature) => feature.projectId === projectId && feature.pinned,
        ).length,
      5,
    );
    assert.equal(
      repo
        .getWorkspace()
        .features.find((feature) => feature.id === otherFeature.id)?.pinned,
      true,
    );
  } finally {
    repo.close();
  }
});

test("reordenar features conserva sus datos y rechaza listas incompletas, duplicadas o de otro proyecto", () => {
  const { repo, projectId } = setup();
  try {
    repo.execute({
      type: "feature.create",
      projectId,
      name: "Segunda",
      description: "Detalle",
    });
    repo.execute({
      type: "feature.create",
      projectId,
      name: "Tercera",
      description: "",
    });
    const ids = repo
      .getWorkspace()
      .features.map((feature) => feature.id)
      .reverse();
    repo.execute({ type: "feature.pin", id: ids[1], pinned: true });
    repo.execute({ type: "feature.reorder", projectId, ids });
    const expected = repo.getWorkspace().features;
    assert.deepEqual(
      expected.map((feature) => feature.id),
      ids,
    );
    assert.equal(expected[1].pinned, true);
    assert.equal(expected[1].description, "Detalle");
    assert.throws(
      () =>
        repo.execute({ type: "feature.reorder", projectId, ids: ids.slice(1) }),
      /cambió/,
    );
    assert.throws(
      () =>
        repo.execute({
          type: "feature.reorder",
          projectId,
          ids: [ids[0], ids[0], ids[2]],
        }),
      /cambió/,
    );
    const other = repo.execute({
      type: "project.create",
      name: "Otro",
      description: "",
      icon: "💡",
      color: "#059669",
    }).createdId!;
    const otherId = repo
      .getWorkspace()
      .features.find((feature) => feature.projectId === other)!.id;
    assert.throws(
      () =>
        repo.execute({
          type: "feature.reorder",
          projectId,
          ids: [ids[0], ids[1], otherId],
        }),
      /cambió/,
    );
    assert.deepEqual(
      repo
        .getWorkspace()
        .features.filter((feature) => feature.projectId === projectId),
      expected,
    );
  } finally {
    repo.close();
  }
});

test("migrar desde v1 conserva tareas, features y orden; las fijadas persisten al reiniciar", async () => {
  const dir = await mkdtemp(join(tmpdir(), "brote-migration-"));
  const path = join(dir, "workspace.sqlite");
  let repo = new SqliteRepository(path, false);
  try {
    const projectId = repo.execute({
      type: "project.create",
      name: "Antes de migrar",
      description: "",
      icon: "🌱",
      color: "#059669",
    }).createdId!;
    const feature = repo.getWorkspace().features[0];
    const status = repo.getWorkspace().statuses[0];
    repo.execute({
      type: "task.create",
      projectId,
      featureId: feature.id,
      statusId: status.id,
      title: "Conservar esta tarea",
      description: "",
      priority: "medium",
      dueDate: null,
      labels: [],
    });
    repo.close();
    const legacy = new DatabaseSync(path);
    downgradeToV3(legacy);
    legacy.exec(
      "ALTER TABLE features DROP COLUMN pinned; ALTER TABLE tasks DROP COLUMN dueTime; PRAGMA user_version=1;",
    );
    legacy.close();
    repo = new SqliteRepository(path, true);
    assert.equal(repo.db.prepare("PRAGMA user_version").get()?.user_version, 7);
    assert.equal(repo.getWorkspace().projects.length, 1);
    assert.equal(repo.getWorkspace().tasks[0].title, "Conservar esta tarea");
    assert.equal(repo.getWorkspace().tasks[0].dueTime, null);
    assert.equal(repo.getWorkspace().features[0].pinned, false);
    repo.execute({ type: "feature.pin", id: feature.id, pinned: true });
    const second = repo.execute({
      type: "feature.create",
      projectId,
      name: "Segunda",
      description: "",
    }).createdId!;
    repo.execute({
      type: "feature.reorder",
      projectId,
      ids: [second, feature.id],
    });
    const saved = repo.getWorkspace();
    repo.close();
    repo = new SqliteRepository(path, true);
    assert.deepEqual(repo.getWorkspace(), saved);
    assert.equal(
      repo.db.prepare("PRAGMA integrity_check").get()?.integrity_check,
      "ok",
    );
  } finally {
    repo.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("las horas se validan, se conservan al archivar y se quitan al eliminar la fecha", () => {
  const { repo, task } = setup();
  try {
    const id = repo.execute(
      commandSchema.parse({ ...task, dueTime: "09:30" }),
    ).createdId!;
    assert.equal(repo.getWorkspace().tasks[0].dueTime, "09:30");
    repo.execute({
      ...task,
      type: "task.update",
      id,
      title: "Cliente sin campo de hora",
    });
    assert.equal(repo.getWorkspace().tasks[0].dueTime, "09:30");
    repo.execute({ type: "task.archive", id, archived: true });
    assert.equal(repo.getWorkspace().tasks[0].dueTime, "09:30");
    repo.execute({ type: "task.archive", id, archived: false });
    assert.equal(repo.getWorkspace().tasks[0].dueTime, "09:30");
    for (const dueTime of ["24:00", "9:30", "12:60", "", "-1:00", "09:30:00"])
      assert.equal(
        commandSchema.safeParse({ ...task, dueTime }).success,
        false,
      );
    assert.throws(
      () => repo.execute({ ...task, dueDate: null, dueTime: "09:30" }),
      /Selecciona una fecha/,
    );
    assert.equal(repo.getWorkspace().tasks.length, 1);
    repo.execute({ ...task, type: "task.update", id, dueDate: null });
    assert.equal(repo.getWorkspace().tasks[0].dueDate, null);
    assert.equal(repo.getWorkspace().tasks[0].dueTime, null);
    repo.execute({ ...task, type: "task.update", id, dueTime: "00:00" });
    assert.equal(repo.getWorkspace().tasks[0].dueTime, "00:00");
    repo.execute({ ...task, type: "task.update", id, dueTime: null });
    assert.equal(repo.getWorkspace().tasks[0].dueTime, null);
  } finally {
    repo.close();
  }
});

test("migrar desde v2 conserva archivo, fechas y fijadas; las horas persisten al reiniciar", async () => {
  const dir = await mkdtemp(join(tmpdir(), "brote-calendar-migration-"));
  const path = join(dir, "workspace.sqlite");
  let repo = new SqliteRepository(path, true);
  try {
    const before = repo.getWorkspace();
    const featureId = before.features[0].id;
    const task = before.tasks[0];
    repo.execute({ type: "feature.pin", id: featureId, pinned: true });
    repo.execute({ type: "task.archive", id: task.id, archived: true });
    const saved = repo.getWorkspace();
    repo.close();
    const legacy = new DatabaseSync(path);
    downgradeToV3(legacy);
    legacy.exec(
      "ALTER TABLE tasks DROP COLUMN dueTime; PRAGMA user_version=2;",
    );
    legacy.close();
    repo = new SqliteRepository(path, true);
    assert.deepEqual(repo.getWorkspace().tasks, saved.tasks);
    assert.deepEqual(repo.getWorkspace().features, saved.features);
    assert.deepEqual(
      repo.getWorkspace().labels.map((l) => l.name),
      saved.labels.map((l) => l.name),
    );
    repo.execute({ type: "task.update", ...task, dueTime: "23:59" });
    const scheduled = repo.getWorkspace();
    assert.equal(
      scheduled.tasks.find((item) => item.id === task.id)?.dueTime,
      "23:59",
    );
    repo.close();
    repo = new SqliteRepository(path, false);
    assert.deepEqual(repo.getWorkspace(), scheduled);
    assert.equal(
      repo.db.prepare("PRAGMA integrity_check").get()?.integrity_check,
      "ok",
    );
  } finally {
    repo.close();
    await rm(dir, { recursive: true, force: true });
  }
});
