import { assertIntegrity } from "./postgres-fixture";
import { actor, createRepository } from "./helpers";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PostgresRepository } from "../src/server/postgres";
async function setup() {
  const repo = await createRepository();
  const projectId = (
    await repo.execute(
      {
        type: "project.create",
        name: "Historial",
        description: "",
        icon: "🌱",
        color: "#059669",
      },
      actor,
    )
  ).createdId!;
  const workspace = await repo.getWorkspace(actor);
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
  const id = (await repo.execute({ type: "task.create", ...fields }, actor))
    .createdId!;
  return { repo, projectId, id, fields, statuses: workspace.statuses };
}
test("el historial registra cambios del detalle y del tablero, sin duplicar al guardar o reordenar", async () => {
  const { repo, id, fields, statuses } = await setup();
  try {
    assert.deepEqual(
      (await repo.getWorkspace(actor)).tasks[0].statusHistory,
      [],
    );
    await repo.execute(
      {
        type: "task.update",
        id,
        ...fields,
        statusId: statuses[1].id,
      },
      actor,
    );
    const first = (await repo.getWorkspace(actor)).tasks[0].statusHistory[0];
    assert.deepEqual(
      [
        first.fromStatusId,
        first.fromStatusName,
        first.toStatusId,
        first.toStatusName,
      ],
      [statuses[0].id, statuses[0].name, statuses[1].id, statuses[1].name],
    );
    assert.equal(
      first.changedAt,
      (await repo.getWorkspace(actor)).tasks[0].updatedAt,
    );
    await repo.execute(
      {
        type: "task.update",
        id,
        ...fields,
        statusId: statuses[1].id,
        description: "Solo texto",
      },
      actor,
    );
    await repo.execute(
      {
        type: "task.move",
        id,
        statusId: statuses[1].id,
        beforeId: null,
      },
      actor,
    );
    assert.deepEqual((await repo.getWorkspace(actor)).tasks[0].statusHistory, [
      first,
    ]);
    await repo.execute(
      {
        type: "task.move",
        id,
        statusId: statuses[2].id,
        beforeId: null,
      },
      actor,
    );
    const history = (await repo.getWorkspace(actor)).tasks[0].statusHistory;
    assert.equal(history.length, 2);
    assert.ok(history[0].id > history[1].id);
    assert.deepEqual(
      [history[0].fromStatusId, history[0].toStatusId],
      [statuses[1].id, statuses[2].id],
    );
    await repo.execute({ type: "task.archive", id, archived: true }, actor);
    assert.deepEqual(
      (await repo.getWorkspace(actor)).tasks[0].statusHistory,
      history,
    );
    await repo.execute({ type: "task.archive", id, archived: false }, actor);
    await repo.execute({ type: "task.rename", id, title: "Renombrada" }, actor);
    assert.deepEqual(
      (await repo.getWorkspace(actor)).tasks[0].statusHistory,
      history,
    );
  } finally {
    await repo.close();
  }
});
test("los cambios rechazados no añaden historial ni modifican la tarea", async () => {
  const { repo, id, fields, statuses } = await setup();
  try {
    const otherProject = (
      await repo.execute(
        {
          type: "project.create",
          name: "Otro",
          description: "",
          icon: "🌱",
          color: "#059669",
        },
        actor,
      )
    ).createdId!;
    const foreignStatus = (await repo.getWorkspace(actor)).statuses.find(
      (status) => status.projectId === otherProject,
    )!.id;
    const before = await repo.getWorkspace(actor);
    await assert.rejects(
      async () =>
        await repo.execute(
          {
            type: "task.update",
            id,
            ...fields,
            statusId: foreignStatus,
          },
          actor,
        ),
      /pertenecer/,
    );
    await assert.rejects(
      async () =>
        await repo.execute(
          {
            type: "task.move",
            id,
            statusId: foreignStatus,
            beforeId: null,
          },
          actor,
        ),
      /otro proyecto/,
    );
    await assert.rejects(
      async () =>
        await repo.execute(
          {
            type: "task.move",
            id,
            statusId: statuses[1].id,
            beforeId: "inexistente",
          },
          actor,
        ),
      /destino/,
    );
    await assert.rejects(
      async () =>
        await repo.execute(
          {
            type: "task.update",
            id,
            ...fields,
            statusId: statuses[1].id,
            priority: "inexistente",
          },
          actor,
        ),
      /prioridad/,
    );
    assert.deepEqual(await repo.getWorkspace(actor), before);
  } finally {
    await repo.close();
  }
});
test("el historial conserva nombres y colores históricos, persiste en respaldo y se elimina con la tarea", async () => {
  const dir = await mkdtemp(join(tmpdir(), "taskode-history-"));
  let { repo, id, statuses } = await setup();
  try {
    await repo.execute(
      {
        type: "task.move",
        id,
        statusId: statuses[1].id,
        beforeId: null,
      },
      actor,
    );
    const history = (await repo.getWorkspace(actor)).tasks[0].statusHistory;
    await repo.execute(
      {
        type: "status.update",
        id: statuses[0].id,
        name: "Renombrado",
        color: "#ffffff",
        isDone: false,
      },
      actor,
    );
    await repo.execute({ type: "status.delete", id: statuses[0].id }, actor);
    assert.deepEqual(
      (await repo.getWorkspace(actor)).tasks[0].statusHistory,
      history,
    );
    assert.equal(history[0].fromStatusColor, statuses[0].color);
    const snapshot = await repo.getWorkspace(actor);
    const backupPath = join(dir, "backup.taskode-backup.json");
    await repo.exportBackup(backupPath);
    const peer = new PostgresRepository(repo.store.connectionString, {
      schema: repo.store.schemaName,
    });
    try {
      assert.deepEqual(await peer.getWorkspace(actor), snapshot);
    } finally {
      await peer.close();
    }
    const restored = await createRepository();
    await restored.restoreBackup(backupPath);
    try {
      assert.deepEqual(await restored.getWorkspace(actor), snapshot);
    } finally {
      await restored.close();
    }
    await repo.execute({ type: "task.delete", id }, actor);
    assert.equal(
      Number(
        (
          await repo.store.pool.query(
            "SELECT COUNT(*) AS n FROM task_status_history",
          )
        ).rows[0].n,
      ),
      0,
    );
    await assertIntegrity(repo);
  } finally {
    await repo.close();
    await rm(dir, {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 50,
    });
  }
});
