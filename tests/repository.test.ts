import { assertIntegrity } from "./postgres-fixture";
import { actor, createRepository } from "./helpers";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PostgresRepository } from "../src/server/postgres";
import {
  commandSchema,
  trelloSchema,
  type Command,
} from "../src/lib/validation";
async function setup() {
  const repo = await createRepository();
  const projectId = (
    await repo.execute(
      {
        type: "project.create",
        name: "Proyecto A",
        description: "Pruebas",
        icon: "🌱",
        color: "#059669",
      },
      actor,
    )
  ).createdId!;
  const w = await repo.getWorkspace(actor);
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
test("crear y editar proyectos conserva emojis compuestos del selector", async () => {
  const repo = await createRepository();
  const fields = { name: "Emojis", description: "", color: "#059669" };
  const england = String.fromCodePoint(
    0x1f3f4,
    0xe0067,
    0xe0062,
    0xe0065,
    0xe006e,
    0xe0067,
    0xe007f,
  );
  try {
    const id = (
      await repo.execute(
        commandSchema.parse({
          type: "project.create",
          ...fields,
          icon: england,
        }),
        actor,
      )
    ).createdId!;
    assert.equal((await repo.getWorkspace(actor)).projects[0].icon, england);
    const couple = "🧑🏽‍❤️‍💋‍🧑🏻";
    await repo.execute(
      commandSchema.parse({
        type: "project.update",
        id,
        ...fields,
        icon: couple,
      }),
      actor,
    );
    assert.equal((await repo.getWorkspace(actor)).projects[0].icon, couple);
  } finally {
    await repo.close();
  }
});
test("las prioridades son personalizables por proyecto y no se pueden borrar mientras estén en uso", async () => {
  const { repo, projectId, task } = await setup();
  try {
    const id = (
      await repo.execute(
        {
          type: "priority.create",
          projectId,
          name: "Urgente",
          color: "#ef4444",
        },
        actor,
      )
    ).createdId!;
    await repo.execute({ ...task, priority: id }, actor);
    await repo.execute(
      {
        type: "priority.update",
        projectId,
        id,
        name: "Crítica",
        color: "#dc2626",
      },
      actor,
    );
    assert.equal(
      (await repo.getWorkspace(actor)).priorities.find((p) => p.id === id)
        ?.name,
      "Crítica",
    );
    await assert.rejects(
      async () =>
        await repo.execute({ type: "priority.delete", projectId, id }, actor),
      /tareas/,
    );
    await assert.rejects(
      async () => await repo.execute({ ...task, priority: "no-existe" }, actor),
      /prioridad/,
    );
    const other = (
      await repo.execute(
        {
          type: "project.create",
          name: "Otro",
          description: "",
          icon: "📋",
          color: "#3b82f6",
        },
        actor,
      )
    ).createdId!;
    await assert.rejects(
      async () =>
        await repo.execute(
          {
            type: "priority.update",
            projectId: other,
            id,
            name: "Ajena",
            color: "#3b82f6",
          },
          actor,
        ),
      /no pertenece/,
    );
    await repo.execute(
      { type: "task.delete", id: (await repo.getWorkspace(actor)).tasks[0].id },
      actor,
    );
    await repo.execute({ type: "priority.delete", projectId, id }, actor);
    assert.equal(
      (await repo.getWorkspace(actor)).priorities.some((p) => p.id === id),
      false,
    );
  } finally {
    await repo.close();
  }
});
test("renombrar y eliminar etiquetas actualiza también tareas archivadas y conserva otros proyectos", async () => {
  const { repo, projectId, task } = await setup();
  try {
    const taskId = (await repo.execute(task, actor)).createdId!;
    const label = (await repo.getWorkspace(actor)).labels[0];
    await repo.execute(
      { type: "task.archive", id: taskId, archived: true },
      actor,
    );
    await repo.execute(
      {
        type: "label.update",
        projectId,
        id: label.id,
        name: "Diseño",
        color: "#8b5cf6",
      },
      actor,
    );
    assert.deepEqual((await repo.getWorkspace(actor)).tasks[0].labels, [
      "Diseño",
    ]);
    assert.equal((await repo.getWorkspace(actor)).labels[0].color, "#8b5cf6");
    await assert.rejects(
      async () =>
        await repo.execute(
          {
            type: "label.create",
            projectId,
            name: "diseño",
            color: "#3b82f6",
          },
          actor,
        ),
      /Ya existe/,
    );
    await repo.execute({ ...task, labels: ["DISEÑO", "Diseño"] }, actor);
    assert.deepEqual((await repo.getWorkspace(actor)).tasks[1].labels, [
      "Diseño",
    ]);
    await repo.execute(
      { type: "label.delete", projectId, id: label.id },
      actor,
    );
    assert.ok(
      (await repo.getWorkspace(actor)).tasks.every(
        (t) => t.labels.length === 0,
      ),
    );
    await assertIntegrity(repo);
  } finally {
    await repo.close();
  }
});
test("checklists y comentarios permiten editar, completar y borrar y se eliminan en cascada", async () => {
  const { repo, task } = await setup();
  try {
    const taskId = (await repo.execute(task, actor)).createdId!;
    const listId = (
      await repo.execute(
        {
          type: "checklist.create",
          taskId,
          title: "Publicar",
        },
        actor,
      )
    ).createdId!;
    const itemId = (
      await repo.execute(
        {
          type: "checklist.item.create",
          checklistId: listId,
          title: "Revisar",
        },
        actor,
      )
    ).createdId!;
    await repo.execute(
      {
        type: "checklist.item.update",
        id: itemId,
        title: "Revisar cambios",
        completed: true,
      },
      actor,
    );
    await repo.execute(
      {
        type: "checklist.update",
        id: listId,
        title: "Antes de publicar",
      },
      actor,
    );
    const commentId = (
      await repo.execute(
        {
          type: "comment.create",
          taskId,
          content: "Primer avance",
        },
        actor,
      )
    ).createdId!;
    await repo.execute(
      {
        type: "comment.update",
        id: commentId,
        content: "Listo para revisar",
      },
      actor,
    );
    const saved = (await repo.getWorkspace(actor)).tasks[0];
    assert.equal(saved.checklists[0].items[0].completed, true);
    assert.equal(saved.checklists[0].title, "Antes de publicar");
    assert.equal(saved.comments[0].content, "Listo para revisar");
    assert.equal(Object.getPrototypeOf(saved.comments[0]), Object.prototype);
    await repo.execute({ type: "comment.delete", id: commentId }, actor);
    assert.equal((await repo.getWorkspace(actor)).tasks[0].comments.length, 0);
    await repo.execute({ type: "task.delete", id: taskId }, actor);
    for (const table of ["checklists", "checklist_items", "comments"])
      assert.equal(
        Number(
          (await repo.store.pool.query(`SELECT COUNT(*) AS n FROM ${table}`))
            .rows[0].n,
        ),
        0,
      );
    await assert.rejects(
      async () =>
        await repo.execute(
          { type: "comment.create", taskId, content: "Huérfano" },
          actor,
        ),
      /ya no existe/,
    );
    assert.equal(
      commandSchema.safeParse({ type: "comment.create", taskId, content: "  " })
        .success,
      false,
    );
  } finally {
    await repo.close();
  }
});
test("el inicio es opcional, persiste en clientes anteriores y el fin debe ser posterior", async () => {
  const { repo, task } = await setup();
  try {
    const id = (
      await repo.execute(
        {
          ...task,
          startDate: "2026-10-15",
          startTime: "09:00",
          dueTime: "11:30",
        },
        actor,
      )
    ).createdId!;
    assert.equal((await repo.getWorkspace(actor)).tasks[0].startTime, "09:00");
    await repo.execute({ ...task, type: "task.update", id }, actor);
    assert.equal((await repo.getWorkspace(actor)).tasks[0].startTime, "09:00");
    for (const fields of [
      { startDate: "2026-10-16" },
      { startDate: "2026-10-15", startTime: "12:00", dueTime: "11:00" },
      { startDate: "2026-10-15", startTime: "11:00", dueTime: "11:00" },
    ]) {
      await assert.rejects(
        async () => await repo.execute({ ...task, ...fields }, actor),
        /posterior al inicio/,
      );
    }
    await assert.rejects(
      async () => await repo.execute({ ...task, startTime: "09:00" }, actor),
      /fecha/,
    );
    assert.equal(
      commandSchema.safeParse({ ...task, startDate: "2026-02-30" }).success,
      false,
    );
    assert.equal(
      commandSchema.safeParse({ ...task, startTime: "24:00" }).success,
      false,
    );
    await repo.execute(
      { ...task, type: "task.update", id, startDate: null },
      actor,
    );
    assert.equal((await repo.getWorkspace(actor)).tasks[0].startTime, null);
    await repo.execute(
      {
        ...task,
        type: "task.update",
        id,
        startDate: "2026-10-20",
        startTime: "10:00",
        dueDate: null,
      },
      actor,
    );
    assert.equal(
      (await repo.getWorkspace(actor)).tasks[0].startDate,
      "2026-10-20",
    );
  } finally {
    await repo.close();
  }
});
test("CRUD persiste campos, estados, archivo y restauración", async () => {
  const { repo, task } = await setup();
  try {
    const id = (await repo.execute(task, actor)).createdId!;
    await repo.execute(
      {
        ...task,
        type: "task.update",
        id,
        title: "Actualizada",
        priority: "high",
      },
      actor,
    );
    await repo.execute({ type: "task.archive", id, archived: true }, actor);
    assert.equal((await repo.getWorkspace(actor)).tasks[0].archived, true);
    assert.equal((await repo.getWorkspace(actor)).tasks[0].priority, "high");
    const beforeRename = (await repo.getWorkspace(actor)).tasks[0];
    await repo.execute(
      commandSchema.parse({ type: "task.rename", id, title: "Título inline" }),
      actor,
    );
    assert.equal(
      (await repo.getWorkspace(actor)).tasks[0].title,
      "Título inline",
    );
    assert.equal(
      (await repo.getWorkspace(actor)).tasks[0].description,
      beforeRename.description,
    );
    assert.deepEqual(
      (await repo.getWorkspace(actor)).tasks[0].labels,
      beforeRename.labels,
    );
    assert.equal(
      commandSchema.safeParse({ type: "task.rename", id, title: " " }).success,
      false,
    );
    await repo.execute({ type: "task.archive", id, archived: false }, actor);
    assert.equal((await repo.getWorkspace(actor)).tasks[0].archived, false);
    await repo.execute({ type: "task.delete", id }, actor);
    assert.equal((await repo.getWorkspace(actor)).tasks.length, 0);
  } finally {
    await repo.close();
  }
});
test("las tareas no pueden cruzar los límites de un proyecto y el fallo revierte la transacción", async () => {
  const { repo, task } = await setup();
  try {
    const p = (
      await repo.execute(
        {
          type: "project.create",
          name: "B",
          description: "",
          icon: "💡",
          color: "#059669",
        },
        actor,
      )
    ).createdId!;
    const other = (await repo.getWorkspace(actor)).statuses.find(
      (s) => s.projectId === p,
    )!;
    await assert.rejects(
      async () => await repo.execute({ ...task, statusId: other.id }, actor),
      /pertenecer al proyecto/,
    );
    assert.equal((await repo.getWorkspace(actor)).tasks.length, 0);
    const id = (await repo.execute(task, actor)).createdId!;
    await assert.rejects(
      async () =>
        await repo.execute(
          {
            type: "task.move",
            id,
            statusId: other.id,
            beforeId: null,
          },
          actor,
        ),
      /otro proyecto/,
    );
    assert.equal(
      (await repo.getWorkspace(actor)).tasks[0].statusId,
      task.statusId,
    );
  } finally {
    await repo.close();
  }
});
test("mover una tarea cambia la columna y mantiene un orden estable", async () => {
  const { repo, task } = await setup();
  try {
    const a = (await repo.execute({ ...task, title: "A" }, actor)).createdId!;
    const b = (await repo.execute({ ...task, title: "B" }, actor)).createdId!;
    const statusId = (await repo.getWorkspace(actor)).statuses[1].id;
    await repo.execute(
      { type: "task.move", id: a, statusId, beforeId: null },
      actor,
    );
    await repo.execute(
      { type: "task.move", id: b, statusId, beforeId: a },
      actor,
    );
    assert.deepEqual(
      (await repo.getWorkspace(actor)).tasks
        .filter((t) => t.statusId === statusId)
        .map((t) => t.title),
      ["B", "A"],
    );
  } finally {
    await repo.close();
  }
});
test("los estados con tareas archivadas no se eliminan ni puede eliminarse el último", async () => {
  const { repo, task } = await setup();
  try {
    const id = (await repo.execute(task, actor)).createdId!;
    await repo.execute({ type: "task.archive", id, archived: true }, actor);
    await assert.rejects(
      async () =>
        await repo.execute({ type: "status.delete", id: task.statusId }, actor),
      /archivadas/,
    );
    (await repo.getWorkspace(actor)).statuses
      .filter((s) => s.id !== task.statusId)
      .forEach(
        async (s) =>
          await repo.execute({ type: "status.delete", id: s.id }, actor),
      );
    await assert.rejects(
      async () =>
        await repo.execute({ type: "status.delete", id: task.statusId }, actor),
      /al menos un estado/,
    );
  } finally {
    await repo.close();
  }
});
test("reordenar requiere exactamente los estados del proyecto", async () => {
  const { repo, projectId } = await setup();
  try {
    const ids = (await repo.getWorkspace(actor)).statuses
      .map((s) => s.id)
      .reverse();
    await repo.execute({ type: "status.reorder", projectId, ids }, actor);
    assert.deepEqual(
      (await repo.getWorkspace(actor)).statuses.map((s) => s.id),
      ids,
    );
    await assert.rejects(
      async () =>
        await repo.execute(
          {
            type: "status.reorder",
            projectId,
            ids: [ids[0], ids[0], ids[1], ids[2]],
          },
          actor,
        ),
      /cambió/,
    );
    assert.deepEqual(
      (await repo.getWorkspace(actor)).statuses.map((s) => s.id),
      ids,
    );
    await assert.rejects(
      async () =>
        await repo.execute(
          {
            type: "status.create",
            projectId,
            name: "pendiente",
            color: "#059669",
            isDone: false,
          },
          actor,
        ),
      /Ya existe/,
    );
  } finally {
    await repo.close();
  }
});
test("borrar una feature o un proyecto elimina sus tareas sin dañar otros proyectos", async () => {
  const { repo, projectId, task } = await setup();
  try {
    await repo.execute(task, actor);
    await repo.execute({ type: "feature.delete", id: task.featureId }, actor);
    assert.equal((await repo.getWorkspace(actor)).tasks.length, 0);
    const other = (
      await repo.execute(
        {
          type: "project.create",
          name: "B",
          description: "",
          icon: "💡",
          color: "#059669",
        },
        actor,
      )
    ).createdId!;
    const featureId = (
      await repo.execute(
        {
          type: "feature.create",
          projectId,
          name: "Nueva",
          description: "",
        },
        actor,
      )
    ).createdId!;
    await repo.execute({ ...task, featureId }, actor);
    await repo.execute({ type: "project.delete", id: projectId }, actor);
    const w = await repo.getWorkspace(actor);
    assert.deepEqual(
      w.projects.map((p) => p.id),
      [other],
    );
    assert.equal(w.tasks.length, 0);
    assert.equal(w.statuses.length, 4);
    await assertIntegrity(repo);
  } finally {
    await repo.close();
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
test("Trello importa fechas, etiquetas y archivo, y repetir la importación no duplica tarjetas ni features", async () => {
  const { repo, projectId } = await setup();
  try {
    assert.equal(
      (await repo.execute({ type: "trello.import", board, projectId }, actor))
        .report?.imported,
      2,
    );
    const w = await repo.getWorkspace(actor);
    const t = w.tasks.find((t) => t.title === "Tarea Trello")!;
    assert.equal(t.dueDate, "2026-10-15");
    assert.deepEqual(t.labels, ["Diseño"]);
    assert.equal(t.description, "Descripción");
    assert.equal(w.tasks.find((t) => t.title === "Archivada")?.archived, true);
    const report = (
      await repo.execute(
        {
          type: "trello.import",
          board,
          projectId,
        },
        actor,
      )
    ).report!;
    assert.equal(report.imported, 0);
    assert.equal(report.skipped, 2);
    assert.equal((await repo.getWorkspace(actor)).features.length, 2);
  } finally {
    await repo.close();
  }
});
test("una importación inválida revierte incluso la creación del proyecto", async () => {
  const { repo } = await setup();
  try {
    await assert.rejects(
      async () =>
        await repo.execute(
          {
            type: "trello.import",
            projectId: null,
            board: { ...board, cards: [board.cards[0], board.cards[0]] },
          },
          actor,
        ),
      /duplicados/,
    );
    assert.equal((await repo.getWorkspace(actor)).projects.length, 1);
    assert.equal((await repo.getWorkspace(actor)).tasks.length, 0);
  } finally {
    await repo.close();
  }
});
test("validación rechaza fechas imposibles y títulos vacíos", async () => {
  const { repo, task } = await setup();
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
    await repo.close();
  }
});
test("el respaldo JSON conserva los datos confirmados y restaura en otra base", async () => {
  const dir = await mkdtemp(join(tmpdir(), "taskode-test-"));
  const repo = await createRepository();
  const copy = await createRepository();
  try {
    const p = (
      await repo.execute(
        {
          type: "project.create",
          name: "Persistente",
          description: "",
          icon: "🌱",
          color: "#059669",
        },
        actor,
      )
    ).createdId!;
    const path = join(dir, "backup.taskode-backup.json");
    await repo.exportBackup(path);
    assert.equal(
      JSON.parse(await readFile(path, "utf8")).format,
      "taskode-backup",
    );
    await copy.restoreBackup(path);
    assert.equal((await copy.getWorkspace(actor)).projects[0].id, p);
    await assertIntegrity(copy);
  } finally {
    await copy.close();
    await repo.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("los datos persisten al reconectar y un espacio vacío no se vuelve a sembrar", async () => {
  const repo = await createRepository();
  const peer = new PostgresRepository(repo.store.connectionString, {
    schema: repo.store.schemaName,
  });
  try {
    assert.equal((await repo.getWorkspace(actor)).projects.length, 0);
    await repo.execute(
      {
        type: "project.create",
        name: "Persistente",
        description: "",
        icon: "🌱",
        color: "#059669",
      },
      actor,
    );
    const first = await repo.getWorkspace(actor);
    assert.equal(first.projects.length, 1);
    assert.deepEqual(await peer.getWorkspace(actor), first);
    await peer.execute(
      { type: "project.delete", id: first.projects[0].id },
      actor,
    );
    assert.equal((await repo.getWorkspace(actor)).projects.length, 0);
  } finally {
    await peer.close();
    await repo.close();
  }
});
test("fijar features respeta el máximo de cinco por proyecto y permite liberar una plaza", async () => {
  const { repo, projectId } = await setup();
  try {
    for (let i = 0; i < 5; i++)
      await repo.execute(
        {
          type: "feature.create",
          projectId,
          name: `Feature ${i}`,
          description: "",
        },
        actor,
      );
    const features = (await repo.getWorkspace(actor)).features;
    for (const feature of features.slice(0, 5))
      await repo.execute(
        { type: "feature.pin", id: feature.id, pinned: true },
        actor,
      );
    await assert.rejects(
      async () =>
        await repo.execute(
          { type: "feature.pin", id: features[5].id, pinned: true },
          actor,
        ),
      /máximo de 5/,
    );
    assert.equal(
      (await repo.getWorkspace(actor)).features.filter(
        (feature) => feature.pinned,
      ).length,
      5,
    );
    await repo.execute(
      { type: "feature.pin", id: features[0].id, pinned: true },
      actor,
    );
    await repo.execute(
      { type: "feature.pin", id: features[0].id, pinned: false },
      actor,
    );
    await repo.execute(
      { type: "feature.pin", id: features[5].id, pinned: true },
      actor,
    );
    const other = (
      await repo.execute(
        {
          type: "project.create",
          name: "Otro proyecto",
          description: "",
          icon: "💡",
          color: "#059669",
        },
        actor,
      )
    ).createdId!;
    const otherFeature = (await repo.getWorkspace(actor)).features.find(
      (feature) => feature.projectId === other,
    )!;
    await repo.execute(
      { type: "feature.pin", id: otherFeature.id, pinned: true },
      actor,
    );
    assert.equal(
      (await repo.getWorkspace(actor)).features.filter(
        (feature) => feature.projectId === projectId && feature.pinned,
      ).length,
      5,
    );
    assert.equal(
      (await repo.getWorkspace(actor)).features.find(
        (feature) => feature.id === otherFeature.id,
      )?.pinned,
      true,
    );
  } finally {
    await repo.close();
  }
});
test("reordenar features conserva sus datos y rechaza listas incompletas, duplicadas o de otro proyecto", async () => {
  const { repo, projectId } = await setup();
  try {
    await repo.execute(
      {
        type: "feature.create",
        projectId,
        name: "Segunda",
        description: "Detalle",
      },
      actor,
    );
    await repo.execute(
      {
        type: "feature.create",
        projectId,
        name: "Tercera",
        description: "",
      },
      actor,
    );
    const ids = (await repo.getWorkspace(actor)).features
      .map((feature) => feature.id)
      .reverse();
    await repo.execute(
      { type: "feature.pin", id: ids[1], pinned: true },
      actor,
    );
    await repo.execute({ type: "feature.reorder", projectId, ids }, actor);
    const expected = (await repo.getWorkspace(actor)).features;
    assert.deepEqual(
      expected.map((feature) => feature.id),
      ids,
    );
    assert.equal(expected[1].pinned, true);
    assert.equal(expected[1].description, "Detalle");
    await assert.rejects(
      async () =>
        await repo.execute(
          { type: "feature.reorder", projectId, ids: ids.slice(1) },
          actor,
        ),
      /cambió/,
    );
    await assert.rejects(
      async () =>
        await repo.execute(
          {
            type: "feature.reorder",
            projectId,
            ids: [ids[0], ids[0], ids[2]],
          },
          actor,
        ),
      /cambió/,
    );
    const other = (
      await repo.execute(
        {
          type: "project.create",
          name: "Otro",
          description: "",
          icon: "💡",
          color: "#059669",
        },
        actor,
      )
    ).createdId!;
    const otherId = (await repo.getWorkspace(actor)).features.find(
      (feature) => feature.projectId === other,
    )!.id;
    await assert.rejects(
      async () =>
        await repo.execute(
          {
            type: "feature.reorder",
            projectId,
            ids: [ids[0], ids[1], otherId],
          },
          actor,
        ),
      /cambió/,
    );
    assert.deepEqual(
      (await repo.getWorkspace(actor)).features.filter(
        (feature) => feature.projectId === projectId,
      ),
      expected,
    );
  } finally {
    await repo.close();
  }
});
test("las horas se validan, se conservan al archivar y se quitan al eliminar la fecha", async () => {
  const { repo, task } = await setup();
  try {
    const id = (
      await repo.execute(
        commandSchema.parse({ ...task, dueTime: "09:30" }),
        actor,
      )
    ).createdId!;
    assert.equal((await repo.getWorkspace(actor)).tasks[0].dueTime, "09:30");
    await repo.execute(
      {
        ...task,
        type: "task.update",
        id,
        title: "Cliente sin campo de hora",
      },
      actor,
    );
    assert.equal((await repo.getWorkspace(actor)).tasks[0].dueTime, "09:30");
    await repo.execute({ type: "task.archive", id, archived: true }, actor);
    assert.equal((await repo.getWorkspace(actor)).tasks[0].dueTime, "09:30");
    await repo.execute({ type: "task.archive", id, archived: false }, actor);
    assert.equal((await repo.getWorkspace(actor)).tasks[0].dueTime, "09:30");
    for (const dueTime of ["24:00", "9:30", "12:60", "", "-1:00", "09:30:00"])
      assert.equal(
        commandSchema.safeParse({ ...task, dueTime }).success,
        false,
      );
    await assert.rejects(
      async () =>
        await repo.execute({ ...task, dueDate: null, dueTime: "09:30" }, actor),
      /Selecciona una fecha/,
    );
    assert.equal((await repo.getWorkspace(actor)).tasks.length, 1);
    await repo.execute(
      { ...task, type: "task.update", id, dueDate: null },
      actor,
    );
    assert.equal((await repo.getWorkspace(actor)).tasks[0].dueDate, null);
    assert.equal((await repo.getWorkspace(actor)).tasks[0].dueTime, null);
    await repo.execute(
      { ...task, type: "task.update", id, dueTime: "00:00" },
      actor,
    );
    assert.equal((await repo.getWorkspace(actor)).tasks[0].dueTime, "00:00");
    await repo.execute(
      { ...task, type: "task.update", id, dueTime: null },
      actor,
    );
    assert.equal((await repo.getWorkspace(actor)).tasks[0].dueTime, null);
  } finally {
    await repo.close();
  }
});
