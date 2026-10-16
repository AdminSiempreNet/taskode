import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { BackupManager } from "../src/server/backups";
import { SqliteRepository } from "../src/server/sqlite";
import { RESTORE_CONFIRMATION } from "../src/lib/backups";

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "brote-backup-test-"));
  const path = join(dir, "workspace.sqlite");
  const repo = new SqliteRepository(path, false);
  const manager = new BackupManager(repo, path);
  const projectId = repo.execute({
    type: "project.create",
    name: "Proyecto recuperado",
    description: "",
    icon: "🌱",
    color: "#059669",
  }).createdId!;
  const workspace = repo.getWorkspace();
  const taskId = repo.execute({
    type: "task.create",
    projectId,
    featureId: workspace.features[0].id,
    statusId: workspace.statuses[0].id,
    title: "Tarea original",
    description: "Detalle",
    priority: "medium",
    labels: ["Original"],
    dueDate: null,
  }).createdId!;
  repo.execute({
    type: "task.move",
    id: taskId,
    statusId: workspace.statuses[1].id,
    beforeId: null,
  });
  repo.execute({
    type: "comment.create",
    taskId,
    content: "Comentario conservado",
  });
  const checklistId = repo.execute({
    type: "checklist.create",
    taskId,
    title: "Checklist",
  }).createdId!;
  repo.execute({
    type: "checklist.item.create",
    checklistId,
    title: "Paso conservado",
  });
  const snapshot = repo.getWorkspace();
  return {
    dir,
    path,
    repo,
    manager,
    taskId,
    snapshot,
    async cleanup() {
      repo.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test("respaldo en servidor: incluye WAL, se lista, descarga, restaura con copia previa y elimina", async () => {
  const s = await setup();
  const observer = new SqliteRepository(s.path, false);
  try {
    assert.deepEqual(await s.manager.list(), []);
    const backup = await s.manager.create();
    assert.equal(backup.kind, "manual");
    assert.ok(backup.size > 0);
    assert.equal(
      (await s.manager.download(backup.id)).subarray(0, 16).toString(),
      "SQLite format 3\0",
    );
    assert.deepEqual(await s.manager.list(), [backup]);
    s.repo.execute({
      type: "task.rename",
      id: s.taskId,
      title: "Cambio posterior",
    });
    const before = s.repo.getWorkspace();
    const { safetyBackup } = await s.manager.restore(
      { backupId: backup.id },
      RESTORE_CONFIRMATION,
      true,
    );
    assert.equal(safetyBackup?.kind, "before-restore");
    assert.deepEqual(s.repo.getWorkspace(), s.snapshot);
    assert.deepEqual(observer.getWorkspace(), s.snapshot);
    assert.deepEqual(s.repo.db.prepare("PRAGMA foreign_key_check").all(), []);
    const safety = new SqliteRepository(
      join(s.manager.directory, safetyBackup!.id),
      false,
    );
    try {
      assert.deepEqual(safety.getWorkspace(), before);
    } finally {
      safety.close();
    }
    const historyId = s.snapshot.tasks[0].statusHistory[0].id;
    s.repo.execute({
      type: "task.move",
      id: s.taskId,
      statusId: s.snapshot.statuses[0].id,
      beforeId: null,
    });
    assert.ok(s.repo.getWorkspace().tasks[0].statusHistory[0].id > historyId);
    await s.manager.delete(backup.id);
    assert.equal((await s.manager.list()).length, 1);
    await assert.rejects(s.manager.download(backup.id), /no existe/);
  } finally {
    observer.close();
    await s.cleanup();
  }
});

test("restaura archivo adjunto sin copia previa y persiste al volver a abrir SQLite", async () => {
  const s = await setup();
  try {
    const backup = await s.manager.create();
    const bytes = await s.manager.download(backup.id);
    s.repo.execute({ type: "task.delete", id: s.taskId });
    const result = await s.manager.restore(
      { file: bytes },
      RESTORE_CONFIRMATION,
      false,
    );
    assert.equal(result.safetyBackup, undefined);
    assert.equal((await s.manager.list()).length, 1);
    assert.deepEqual(s.repo.getWorkspace(), s.snapshot);
    const reopened = new SqliteRepository(s.path, false);
    try {
      assert.deepEqual(reopened.getWorkspace(), s.snapshot);
    } finally {
      reopened.close();
    }
  } finally {
    await s.cleanup();
  }
});

test("exige la confirmación exacta, bloquea rutas ajenas y rechaza respaldos inexistentes", async () => {
  const s = await setup();
  try {
    const backup = await s.manager.create();
    for (const confirmation of ["", "restaurar", " RESTAURAR", "RESTAURAR "])
      await assert.rejects(
        s.manager.restore({ backupId: backup.id }, confirmation, true),
        /Escribe RESTAURAR/,
      );
    for (const id of [
      "../workspace.sqlite",
      s.path,
      "missing.sqlite",
      "..\\workspace.sqlite",
    ])
      await assert.rejects(s.manager.delete(id), /no existe/);
    await s.manager.delete(backup.id);
    await assert.rejects(
      s.manager.restore({ backupId: backup.id }, RESTORE_CONFIRMATION, true),
      /no existe/,
    );
    assert.deepEqual(s.repo.getWorkspace(), s.snapshot);
    assert.deepEqual(await s.manager.list(), []);
  } finally {
    await s.cleanup();
  }
});

test("valida corrupción, estructura, versión, etiquetas y referencias antes de crear respaldo previo o cambiar datos", async () => {
  const s = await setup();
  try {
    await assert.rejects(
      s.manager.restore(
        { file: Buffer.from("archivo incorrecto") },
        RESTORE_CONFIRMATION,
        true,
      ),
      /válido/,
    );
    const path = join(s.dir, "invalid.sqlite");
    const mutations = [
      "PRAGMA user_version=99;",
      "PRAGMA user_version=0;",
      "DROP TABLE comments;",
      "CREATE VIEW unexpected AS SELECT * FROM tasks;",
      "CREATE TRIGGER unexpected AFTER INSERT ON projects BEGIN DELETE FROM tasks; END;",
      "PRAGMA foreign_keys=OFF; UPDATE tasks SET projectId='inexistente';",
      "UPDATE tasks SET labels='{}';",
    ];
    for (const mutation of mutations) {
      await s.repo.exportBackup(path);
      const invalid = new DatabaseSync(path);
      try {
        invalid.exec(mutation);
      } finally {
        invalid.close();
      }
      await assert.rejects(
        s.manager.restore(
          { file: await readFile(path) },
          RESTORE_CONFIRMATION,
          true,
        ),
      );
      assert.deepEqual(s.repo.getWorkspace(), s.snapshot);
      assert.deepEqual(await s.manager.list(), []);
    }
    assert.deepEqual(
      (await readdir(s.manager.directory)).filter((name) =>
        name.startsWith(".pending"),
      ),
      [],
    );
  } finally {
    await s.cleanup();
  }
});

test("si falla el respaldo previo se cancela la restauración y se libera el bloqueo", async () => {
  const s = await setup();
  try {
    const backup = await s.manager.create();
    s.repo.execute({
      type: "task.rename",
      id: s.taskId,
      title: "Conservar este cambio",
    });
    const current = s.repo.getWorkspace();
    const exportBackup = s.repo.exportBackup.bind(s.repo);
    s.repo.exportBackup = async () => {
      throw new Error("No hay espacio para el respaldo");
    };
    await assert.rejects(
      s.manager.restore({ backupId: backup.id }, RESTORE_CONFIRMATION, true),
      /No hay espacio/,
    );
    assert.deepEqual(s.repo.getWorkspace(), current);
    assert.equal(
      s.repo.db.prepare("PRAGMA foreign_keys").get()?.foreign_keys,
      1,
    );
    s.repo.exportBackup = exportBackup;
    await s.manager.restore(
      { backupId: backup.id },
      RESTORE_CONFIRMATION,
      false,
    );
    assert.deepEqual(s.repo.getWorkspace(), s.snapshot);
  } finally {
    await s.cleanup();
  }
});

test("un fallo al copiar filas revierte todos los datos y reactiva las claves foráneas", async () => {
  const s = await setup();
  try {
    const backup = await s.manager.create();
    s.repo.execute({
      type: "task.rename",
      id: s.taskId,
      title: "Se conserva tras rollback",
    });
    const current = s.repo.getWorkspace();
    s.repo.db.exec(
      "CREATE TRIGGER fail_restore BEFORE INSERT ON tasks BEGIN SELECT RAISE(ABORT,'fallo simulado'); END;",
    );
    await assert.rejects(
      s.manager.restore({ backupId: backup.id }, RESTORE_CONFIRMATION, false),
      /fallo simulado/,
    );
    assert.deepEqual(s.repo.getWorkspace(), current);
    assert.equal(
      s.repo.db.prepare("PRAGMA foreign_keys").get()?.foreign_keys,
      1,
    );
    s.repo.db.exec("DROP TRIGGER fail_restore;");
    await s.manager.restore(
      { backupId: backup.id },
      RESTORE_CONFIRMATION,
      false,
    );
    assert.deepEqual(s.repo.getWorkspace(), s.snapshot);
  } finally {
    await s.cleanup();
  }
});

test("migra respaldos v5 en una copia aislada y no modifica el archivo original", async () => {
  const s = await setup();
  try {
    const path = join(s.dir, "legacy.sqlite");
    await s.repo.exportBackup(path);
    const legacy = new DatabaseSync(path);
    try {
      legacy.exec("DROP TABLE task_status_history; DROP INDEX feature_number; ALTER TABLE features DROP COLUMN number; PRAGMA user_version=5;");
    } finally {
      legacy.close();
    }
    const bytes = await readFile(path);
    s.repo.execute({ type: "task.delete", id: s.taskId });
    await s.manager.restore({ file: bytes }, RESTORE_CONFIRMATION, false);
    assert.equal(s.repo.getWorkspace().tasks[0].title, "Tarea original");
    assert.deepEqual(s.repo.getWorkspace().tasks[0].statusHistory, []);
    assert.deepEqual(await readFile(path), bytes);
    assert.equal(
      s.repo.db.prepare("PRAGMA user_version").get()?.user_version,
      7,
    );
  } finally {
    await s.cleanup();
  }
});

test("bloquea cambios durante el respaldo previo y operaciones de respaldo simultáneas", async () => {
  const s = await setup();
  try {
    const backup = await s.manager.create();
    let release!: () => void;
    let entered!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const original = s.repo.exportBackup.bind(s.repo);
    s.repo.exportBackup = async (destination) => {
      entered();
      await wait;
      await original(destination);
    };
    const restoring = s.manager.restore(
      { backupId: backup.id },
      RESTORE_CONFIRMATION,
      true,
    );
    await started;
    try {
      assert.throws(
        () =>
          s.repo.execute({
            type: "task.rename",
            id: s.taskId,
            title: "Cambio concurrente",
          }),
        /restauración en curso/,
      );
      await assert.rejects(
        s.manager.delete(backup.id),
        /operación de respaldo en curso/,
      );
      await assert.rejects(
        s.manager.create(),
        /operación de respaldo en curso/,
      );
    } finally {
      release();
    }
    await restoring;
    assert.deepEqual(s.repo.getWorkspace(), s.snapshot);
  } finally {
    await s.cleanup();
  }
});
