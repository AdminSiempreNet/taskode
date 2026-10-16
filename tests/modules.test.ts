import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SqliteRepository } from "../src/server/sqlite";
import { commandSchema } from "../src/lib/validation";

function project(repo: SqliteRepository, name = "Proyecto") {
  return repo.execute({
    type: "project.create",
    name,
    description: "",
    icon: "🌱",
    color: "#059669",
  }).createdId!;
}
function module(repo: SqliteRepository, projectId: string, name: string) {
  return repo.execute({
    type: "module.create",
    projectId,
    name,
    description: `Descripción de ${name}`,
  }).createdId!;
}

test("el módulo es opcional y cambiarlo asigna un número del destino conservando tareas, posición y fijadas", () => {
  const repo = new SqliteRepository(":memory:", false);
  try {
    const projectId = project(repo);
    const a = module(repo, projectId, "Administración");
    const b = module(repo, projectId, "Comunicaciones");
    const first = repo.getWorkspace().features[0];
    assert.equal(first.moduleId, null);
    const second = repo.execute(
      commandSchema.parse({
        type: "feature.create",
        projectId,
        name: "Usuarios",
        moduleId: a,
      }),
    ).createdId!;
    const third = repo.execute(
      commandSchema.parse({
        type: "feature.create",
        projectId,
        name: "Mensajes",
        moduleId: b,
      }),
    ).createdId!;
    const fourth = repo.execute(
      commandSchema.parse({
        type: "feature.create",
        projectId,
        name: "Sin módulo",
      }),
    ).createdId!;
    const before = repo.getWorkspace().features;
    assert.deepEqual(
      before.map((feature) => feature.position),
      [0, 1, 2, 3],
    );
    assert.deepEqual(
      before.map((feature) => feature.moduleId),
      [null, a, b, null],
    );
    assert.deepEqual(before.map((feature) => feature.number), [1, 1, 1, 2]);
    repo.execute({ type: "feature.pin", id: second, pinned: true });
    repo.execute({
      type: "task.create",
      projectId,
      featureId: second,
      statusId: repo.getWorkspace().statuses[0].id,
      title: "Conservar tarea",
      description: "",
      priority: "medium",
      dueDate: null,
      labels: [],
    });
    const tasks = repo.getWorkspace().tasks;
    repo.execute({
      type: "feature.update",
      id: second,
      name: "Usuarios",
      description: "",
      moduleId: b,
    });
    let saved = repo.getWorkspace();
    assert.equal(
      saved.features.find((feature) => feature.id === second)?.moduleId,
      b,
    );
    assert.equal(
      saved.features.find((feature) => feature.id === second)?.pinned,
      true,
    );
    assert.equal(saved.features.find((feature) => feature.id === second)?.number, 2);
    assert.deepEqual(
      saved.features.map((feature) => [feature.id, feature.position]),
      before.map((feature) => [feature.id, feature.position]),
    );
    // Older clients that omit moduleId must not move the feature to General.
    repo.execute(
      commandSchema.parse({
        type: "feature.update",
        id: second,
        name: "Usuarios editados",
      }),
    );
    assert.equal(
      repo.getWorkspace().features.find((feature) => feature.id === second)
        ?.moduleId,
      b,
    );
    repo.execute({
      type: "feature.update",
      id: third,
      name: "Mensajes",
      description: "",
      moduleId: null,
    });
    saved = repo.getWorkspace();
    assert.equal(
      saved.features.find((feature) => feature.id === third)?.moduleId,
      null,
    );
    assert.equal(saved.features.find((feature) => feature.id === third)?.number, 3);
    assert.equal(
      saved.features.find((feature) => feature.id === fourth)?.moduleId,
      null,
    );
    assert.deepEqual(saved.tasks, tasks);
    assert.deepEqual(repo.db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    repo.close();
  }
});

test("no se asignan módulos de otro proyecto o inexistentes y los errores no modifican datos", () => {
  const repo = new SqliteRepository(":memory:", false);
  try {
    const a = project(repo);
    const b = project(repo, "Otro");
    const foreignModule = module(repo, b, "Ajeno");
    const feature = repo
      .getWorkspace()
      .features.find((feature) => feature.projectId === a)!;
    const before = repo.getWorkspace();
    for (const moduleId of [foreignModule, "inexistente"]) {
      assert.throws(
        () =>
          repo.execute({
            type: "feature.create",
            projectId: a,
            name: "Inválida",
            description: "",
            moduleId,
          }),
        /módulo|ya no existe/,
      );
      assert.throws(
        () =>
          repo.execute({
            type: "feature.update",
            id: feature.id,
            name: "No guardar",
            description: "",
            moduleId,
          }),
        /módulo|ya no existe/,
      );
      assert.deepEqual(repo.getWorkspace(), before);
    }
    assert.equal(
      commandSchema.safeParse({
        type: "module.create",
        projectId: a,
        name: " ",
      }).success,
      false,
    );
    assert.equal(
      commandSchema.safeParse({
        type: "feature.create",
        projectId: a,
        name: "Inválida",
        moduleId: "",
      }).success,
      false,
    );
  } finally {
    repo.close();
  }
});

test("editar y ordenar módulos conserva el orden de features y rechaza órdenes incompletos o ajenos", () => {
  const repo = new SqliteRepository(":memory:", false);
  try {
    const projectId = project(repo);
    const a = module(repo, projectId, "Uno");
    const b = module(repo, projectId, "Dos");
    const c = module(repo, project(repo, "Otro"), "Ajeno");
    repo.execute({
      type: "module.update",
      id: a,
      name: "Administración",
      description: "Descripción nueva",
    });
    repo.execute({ type: "module.reorder", projectId, ids: [b, a] });
    const before = repo.getWorkspace();
    assert.deepEqual(
      before.modules
        .filter((item) => item.projectId === projectId)
        .map((item) => [item.id, item.position]),
      [
        [b, 0],
        [a, 1],
      ],
    );
    assert.equal(
      before.modules.find((item) => item.id === a)?.description,
      "Descripción nueva",
    );
    for (const ids of [[a], [a, a], [a, c], [a, b, c]]) {
      assert.throws(
        () => repo.execute({ type: "module.reorder", projectId, ids }),
        /lista de módulos/,
      );
      assert.deepEqual(repo.getWorkspace(), before);
    }
  } finally {
    repo.close();
  }
});

test("eliminar un módulo pasa sus features a General y conserva tareas archivadas y relaciones", () => {
  const repo = new SqliteRepository(":memory:", false);
  try {
    const projectId = project(repo);
    const id = module(repo, projectId, "Eliminar");
    const feature = repo.getWorkspace().features[0];
    repo.execute({
      type: "feature.update",
      id: feature.id,
      name: feature.name,
      description: "",
      moduleId: id,
    });
    const taskId = repo.execute({
      type: "task.create",
      projectId,
      featureId: feature.id,
      statusId: repo.getWorkspace().statuses[0].id,
      title: "Archivada",
      description: "",
      priority: "medium",
      dueDate: null,
      labels: [],
    }).createdId!;
    repo.execute({ type: "task.archive", id: taskId, archived: true });
    repo.execute({ type: "comment.create", taskId, content: "Conservar" });
    const before = repo.getWorkspace();
    repo.execute({ type: "module.delete", id });
    assert.deepEqual(
      repo.getWorkspace().features,
      before.features.map((feature) => ({ ...feature, moduleId: null })),
    );
    assert.deepEqual(repo.getWorkspace().tasks, before.tasks);
    assert.deepEqual(repo.getWorkspace().modules, []);
    module(repo, projectId, "Cascada");
    repo.execute({ type: "project.delete", id: projectId });
    assert.deepEqual(repo.getWorkspace().modules, []);
    assert.deepEqual(repo.db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    repo.close();
  }
});

test("la migración v4 conserva el espacio completo; módulos y asignaciones persisten en reinicio y respaldo", async () => {
  const dir = await mkdtemp(join(tmpdir(), "brote-modules-"));
  const path = join(dir, "workspace.sqlite");
  let repo = new SqliteRepository(path, true);
  try {
    const initial = repo.getWorkspace();
    const taskId = initial.tasks[0].id;
    repo.execute({
      type: "feature.pin",
      id: initial.features[0].id,
      pinned: true,
    });
    repo.execute({
      type: "checklist.create",
      taskId,
      title: "Conservar checklist",
    });
    repo.execute({
      type: "comment.create",
      taskId,
      content: "Conservar comentario",
    });
    const before = repo.getWorkspace();
    repo.close();
    const legacy = new DatabaseSync(path);
    legacy.exec(
      "DROP TABLE task_status_history; DROP INDEX checklist_task; CREATE INDEX checklist_task ON checklists(taskId); DROP INDEX feature_number; ALTER TABLE features DROP COLUMN number; DROP INDEX feature_module; ALTER TABLE features DROP COLUMN moduleId; DROP TABLE modules; PRAGMA user_version=4;",
    );
    legacy.close();
    repo = new SqliteRepository(path, true);
    assert.deepEqual(repo.getWorkspace(), before);
    assert.equal(repo.db.prepare("PRAGMA user_version").get()?.user_version, 7);
    const id = module(repo, initial.projects[0].id, "Persistente");
    const feature = initial.features[0];
    repo.execute({
      type: "feature.update",
      id: feature.id,
      name: feature.name,
      description: feature.description,
      moduleId: id,
    });
    const saved = repo.getWorkspace();
    const backupPath = join(dir, "backup.sqlite");
    await repo.exportBackup(backupPath);
    repo.close();
    repo = new SqliteRepository(path, false);
    assert.deepEqual(repo.getWorkspace(), saved);
    const restored = new SqliteRepository(backupPath, false);
    try {
      assert.deepEqual(restored.getWorkspace(), saved);
      assert.deepEqual(
        restored.db.prepare("PRAGMA foreign_key_check").all(),
        [],
      );
      assert.equal(
        restored.db.prepare("PRAGMA integrity_check").get()?.integrity_check,
        "ok",
      );
    } finally {
      restored.close();
    }
  } finally {
    repo.close();
    await rm(dir, { recursive: true, force: true });
  }
});
