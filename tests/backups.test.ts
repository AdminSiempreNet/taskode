import { assertIntegrity } from "./postgres-fixture";
import { actor, createRepository } from "./helpers";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BackupManager } from "../src/server/backups";
import { PostgresRepository } from "../src/server/postgres";
import { RESTORE_CONFIRMATION } from "../src/lib/backups";
import type { ApplicationBackup } from "../src/server/backup-data";
import { session, invitations } from "../src/server/schema";
import { randomUUID } from "node:crypto";
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "taskode-backup-test-"));
  const path = dir;
  const repo = await createRepository();
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
        labels: ["Original"],
        dueDate: null,
      },
      actor,
    )
  ).createdId!;
  await repo.execute({ type: "ticket.create", number: "001234", description: "", url: null, clientId: null, scope: { kind: "task", id: taskId, projectId } }, actor);
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
test("respaldo JSON: lista, descarga, restaura con copia previa y elimina; reajusta la secuencia", async () => {
  const s = await setup();
  const observer = new PostgresRepository(s.repo.store.connectionString, {
    schema: s.repo.store.schemaName,
  });
  try {
    assert.deepEqual(await s.manager.list(), []);
    const backup = await s.manager.create();
    const file = JSON.parse(
      (await s.manager.download(backup.id)).toString(),
    ) as ApplicationBackup;
    assert.equal(file.format, "taskode-backup");
    assert.equal(file.version, 12);
    assert.equal(file.tables.session, undefined);
    assert.equal(file.tables.verification, undefined);
    assert.deepEqual(await s.manager.list(), [backup]);
    await s.repo.execute(
      { type: "task.rename", id: s.taskId, title: "Cambio posterior" },
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
    const safety = await createRepository();
    try {
      await safety.restoreBackup(join(s.manager.directory, safetyBackup!.id));
      assert.deepEqual(await safety.getWorkspace(actor), before);
    } finally {
      await safety.close();
    }
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
        s.snapshot.tasks[0].statusHistory[0].id,
    );
    await assertIntegrity(s.repo);
    await s.manager.delete(backup.id);
    await assert.rejects(s.manager.download(backup.id), /no existe/);
  } finally {
    await observer.close();
    await s.cleanup();
  }
});

test("restaura archivo adjunto sin copia previa y los datos persisten en otra conexión", async () => {
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
    const peer = new PostgresRepository(s.repo.store.connectionString, {
      schema: s.repo.store.schemaName,
    });
    try {
      assert.deepEqual(await peer.getWorkspace(actor), s.snapshot);
    } finally {
      await peer.close();
    }
  } finally {
    await s.cleanup();
  }
});

test("exige confirmación exacta y rechaza rutas ajenas y archivos SQLite anteriores", async () => {
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
      "missing.json",
      "..\\backup.json",
    ])
      await assert.rejects(s.manager.delete(id), /no existe/);
    await assert.rejects(
      s.manager.restore(
        { file: Buffer.from("SQLite format 3\0") },
        RESTORE_CONFIRMATION,
        false,
      ),
      /SQLite anteriores/,
    );
    assert.deepEqual(await s.repo.getWorkspace(actor), s.snapshot);
  } finally {
    await s.cleanup();
  }
});

test("valida versión, tablas, campos, referencias, tipos y unicidad antes de crear respaldo previo", async () => {
  const s = await setup();
  try {
    const backup = await s.manager.create();
    const original = JSON.parse(
      (await s.manager.download(backup.id)).toString(),
    ) as ApplicationBackup;
    const mutations: ((file: ApplicationBackup) => void)[] = [
      (file) => {
        (file as { version: number }).version = 99;
      },
      (file) => {
        delete file.tables.comments;
      },
      (file) => {
        file.tables.unexpected = [];
      },
      (file) => {
        file.tables.tasks[0].unexpected = "extra";
      },
      (file) => {
        file.tables.tasks[0].projectId = "inexistente";
      },
      (file) => {
        file.tables.tasks[0].labels = false;
      },
      (file) => {
        file.tables.user[0].role = "invalid";
      },
      (file) => {
        file.tables.installation[0].adminId = "invalid";
      },
      (file) => {
        file.tables.tasks.push({ ...file.tables.tasks[0] });
      },
      (file) => {
        file.tables.tasks[0].dueTime = "25:00";
      },
      (file) => {
        file.tables.tasks[0].createdAt = "fecha inválida";
      },
      (file) => {
        file.tables.features[0].number = 2147483648;
      },
    ];
    for (const mutate of mutations) {
      const file = structuredClone(original);
      mutate(file);
      await assert.rejects(
        s.manager.restore(
          { file: Buffer.from(JSON.stringify(file)) },
          RESTORE_CONFIRMATION,
          true,
        ),
      );
      assert.deepEqual(await s.repo.getWorkspace(actor), s.snapshot);
      assert.equal((await s.manager.list()).length, 1);
    }
    await assert.rejects(
      s.manager.restore(
        { file: Buffer.from("invalid json") },
        RESTORE_CONFIRMATION,
        true,
      ),
      /JSON válido/,
    );
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

test("si falla la copia previa se conserva el estado actual y se liberan los bloqueos", async () => {
  const s = await setup();
  try {
    const backup = await s.manager.create();
    await s.repo.execute(
      { type: "task.rename", id: s.taskId, title: "Conservar cambio" },
      actor,
    );
    const current = await s.repo.getWorkspace(actor);
    const original = s.repo.exportBackup.bind(s.repo);
    s.repo.exportBackup = async () => {
      throw new Error("No hay espacio");
    };
    await assert.rejects(
      s.manager.restore({ backupId: backup.id }, RESTORE_CONFIRMATION, true),
      /No hay espacio/,
    );
    assert.deepEqual(await s.repo.getWorkspace(actor), current);
    s.repo.exportBackup = original;
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

test("un fallo de inserción revierte toda la restauración y mantiene las restricciones", async () => {
  const s = await setup();
  try {
    const backup = await s.manager.create();
    await s.repo.execute(
      { type: "task.rename", id: s.taskId, title: "Conservar tras rollback" },
      actor,
    );
    const current = await s.repo.getWorkspace(actor);
    await s.repo.store.pool
      .query(`CREATE FUNCTION fail_restore() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fallo simulado'; END $$;
CREATE TRIGGER fail_restore BEFORE INSERT ON tasks FOR EACH ROW EXECUTE FUNCTION fail_restore();`);
    await assert.rejects(
      s.manager.restore({ backupId: backup.id }, RESTORE_CONFIRMATION, false),
    );
    assert.deepEqual(await s.repo.getWorkspace(actor), current);
    await assertIntegrity(s.repo);
    await s.repo.store.pool.query(
      "DROP TRIGGER fail_restore ON tasks; DROP FUNCTION fail_restore();",
    );
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

test("coordina restauración, escrituras y respaldos simultáneos entre dos instancias", async () => {
  const s = await setup();
  const peer = new PostgresRepository(s.repo.store.connectionString, {
    schema: s.repo.store.schemaName,
  });
  const other = new BackupManager(peer, s.manager.directory);
  try {
    const backup = await s.manager.create();
    let release!: () => void, entered!: () => void;
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
        peer.execute(
          { type: "task.rename", id: s.taskId, title: "Concurrente" },
          actor,
        ),
        /restauración en curso/,
      );
      await assert.rejects(other.create(), /operación de respaldo en curso/);
      await assert.rejects(
        s.manager.delete(backup.id),
        /operación de respaldo en curso/,
      );
    } finally {
      release();
    }
    await restoring;
    assert.deepEqual(await s.repo.getWorkspace(actor), s.snapshot);
  } finally {
    await peer.close();
    await s.cleanup();
  }
});

test("restaurar invalida sesiones, revoca invitaciones pendientes y conserva las aceptadas", async () => {
  const s = await setup();
  try {
    const now = new Date();
    await s.repo.store.db.insert(session).values({
      id: randomUUID(),
      token: randomUUID(),
      userId: actor.id,
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(Date.now() + 86400000),
    });
    await s.repo.store.db.insert(invitations).values({
      id: "pending",
      email: "pending@example.com",
      createdBy: actor.id,
      createdAt: Date.now(),
      expiresAt: Date.now() + 86400000,
    });
    await s.repo.store.db.insert(invitations).values({
      id: "accepted",
      email: "accepted@example.com",
      createdBy: actor.id,
      createdAt: Date.now(),
      expiresAt: Date.now() + 86400000,
      acceptedAt: Date.now(),
      acceptedBy: actor.id,
    });
    const backup = await s.manager.create();
    await s.manager.restore(
      { backupId: backup.id },
      RESTORE_CONFIRMATION,
      false,
    );
    assert.equal((await s.repo.store.db.select().from(session)).length, 0);
    const restoredInvites = await s.repo.store.db.select().from(invitations);
    assert.ok(restoredInvites.find((row) => row.id === "pending")!.revokedAt);
    assert.equal(
      restoredInvites.find((row) => row.id === "accepted")!.revokedAt,
      null,
    );
  } finally {
    await s.cleanup();
  }
});
