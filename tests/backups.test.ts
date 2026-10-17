import { actor, createRepository } from "./helpers";
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
  const repo = await createRepository(path, false);
  const manager = new BackupManager(repo, path);
  const projectId = (
    await repo.execute(
      {
        type: "project.create",
        name: "Proyecto recuperado",
        description: "",
        icon: "🌱",
        color: "#059669",
      },
      actor,
    )
  ).createdId!;
  const workspace = await repo.getWorkspace(actor);
  const taskId = (
    await repo.execute(
      {
        type: "task.create",
        projectId,
        featureId: workspace.features[0].id,
        statusId: workspace.statuses[0].id,
        title: "Tarea original",
        description: "Detalle",
        priority: "medium",
        typeId: workspace.taskTypes[0].id,
        impactId: workspace.impacts[0].id,
        ticketNumber: "001234",
        labels: ["Original"],
        dueDate: null,
      },
      actor,
    )
  ).createdId!;
  await repo.execute(
    {
      type: "task.move",
      id: taskId,
      statusId: workspace.statuses[1].id,
      beforeId: null,
    },
    actor,
  );
  await repo.execute(
    {
      type: "comment.create",
      taskId,
      content: "Comentario conservado",
    },
    actor,
  );
  const checklistId = (
    await repo.execute(
      {
        type: "checklist.create",
        taskId,
        title: "Checklist",
      },
      actor,
    )
  ).createdId!;
  await repo.execute(
    {
      type: "checklist.item.create",
      checklistId,
      title: "Paso conservado",
    },
    actor,
  );
  const snapshot = await repo.getWorkspace(actor);
  return {
    dir,
    path,
    repo,
    manager,
    taskId,
    snapshot,
    async cleanup() {
      await repo.close();
      await rm(dir, {
        recursive: true,
        force: true,
        maxRetries: 20,
        retryDelay: 50,
      });
    },
  };
}
test("respaldo en servidor: incluye WAL, se lista, descarga, restaura con copia previa y elimina", async () => {
  const s = await setup();
  const observer = await createRepository(s.path, false);
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
    await s.repo.execute(
      {
        type: "task.rename",
        id: s.taskId,
        title: "Cambio posterior",
      },
      actor,
    );
    const before = await s.repo.getWorkspace(actor);
    const { safetyBackup } = await s.manager.restore(
      { backupId: backup.id },
      RESTORE_CONFIRMATION,
      true,
    );
    assert.equal(safetyBackup?.kind, "before-restore");
    assert.deepEqual(await s.repo.getWorkspace(actor), s.snapshot);
    assert.deepEqual(await observer.getWorkspace(actor), s.snapshot);
    assert.deepEqual(s.repo.db.prepare("PRAGMA foreign_key_check").all(), []);
    const safety = await createRepository(
      join(s.manager.directory, safetyBackup!.id),
      false,
    );
    try {
      assert.deepEqual(await safety.getWorkspace(actor), before);
    } finally {
      await safety.close();
    }
    const historyId = s.snapshot.tasks[0].statusHistory[0].id;
    await s.repo.execute(
      {
        type: "task.move",
        id: s.taskId,
        statusId: s.snapshot.statuses[0].id,
        beforeId: null,
      },
      actor,
    );
    assert.ok(
      (await s.repo.getWorkspace(actor)).tasks[0].statusHistory[0].id >
        historyId,
    );
    await s.manager.delete(backup.id);
    assert.equal((await s.manager.list()).length, 1);
    await assert.rejects(s.manager.download(backup.id), /no existe/);
  } finally {
    await observer.close();
    await s.cleanup();
  }
});
test("restaura archivo adjunto sin copia previa y persiste al volver a abrir SQLite", async () => {
  const s = await setup();
  try {
    const backup = await s.manager.create();
    const bytes = await s.manager.download(backup.id);
    await s.repo.execute({ type: "task.delete", id: s.taskId }, actor);
    const result = await s.manager.restore(
      { file: bytes },
      RESTORE_CONFIRMATION,
      false,
    );
    assert.equal(result.safetyBackup, undefined);
    assert.equal((await s.manager.list()).length, 1);
    assert.deepEqual(await s.repo.getWorkspace(actor), s.snapshot);
    const reopened = await createRepository(s.path, false);
    try {
      assert.deepEqual(await reopened.getWorkspace(actor), s.snapshot);
    } finally {
      await reopened.close();
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
    assert.deepEqual(await s.repo.getWorkspace(actor), s.snapshot);
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
      "PRAGMA user_version=7;",
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
        await invalid.close();
      }
      await assert.rejects(
        s.manager.restore(
          { file: await readFile(path) },
          RESTORE_CONFIRMATION,
          true,
        ),
      );
      assert.deepEqual(await s.repo.getWorkspace(actor), s.snapshot);
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
    await s.repo.execute(
      {
        type: "task.rename",
        id: s.taskId,
        title: "Conservar este cambio",
      },
      actor,
    );
    const current = await s.repo.getWorkspace(actor);
    const exportBackup = s.repo.exportBackup.bind(s.repo);
    s.repo.exportBackup = async () => {
      throw new Error("No hay espacio para el respaldo");
    };
    await assert.rejects(
      s.manager.restore({ backupId: backup.id }, RESTORE_CONFIRMATION, true),
      /No hay espacio/,
    );
    assert.deepEqual(await s.repo.getWorkspace(actor), current);
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
    assert.deepEqual(await s.repo.getWorkspace(actor), s.snapshot);
  } finally {
    await s.cleanup();
  }
});
test("un fallo al copiar filas revierte todos los datos y reactiva las claves foráneas", async () => {
  const s = await setup();
  try {
    const backup = await s.manager.create();
    await s.repo.execute(
      {
        type: "task.rename",
        id: s.taskId,
        title: "Se conserva tras rollback",
      },
      actor,
    );
    const current = await s.repo.getWorkspace(actor);
    s.repo.db.exec(
      "CREATE TRIGGER fail_restore BEFORE INSERT ON tasks BEGIN SELECT RAISE(ABORT,'fallo simulado'); END;",
    );
    await assert.rejects(
      s.manager.restore({ backupId: backup.id }, RESTORE_CONFIRMATION, false),
      /fallo simulado/,
    );
    assert.deepEqual(await s.repo.getWorkspace(actor), current);
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
    assert.deepEqual(await s.repo.getWorkspace(actor), s.snapshot);
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
      await assert.rejects(
        async () =>
          await s.repo.execute(
            {
              type: "task.rename",
              id: s.taskId,
              title: "Cambio concurrente",
            },
            actor,
          ),
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
    assert.deepEqual(await s.repo.getWorkspace(actor), s.snapshot);
  } finally {
    await s.cleanup();
  }
});
