import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { actor, addUser, createRepository } from "./helpers";
import { SqliteRepository } from "../src/server/sqlite";
import { commandSchema } from "../src/lib/validation";
import { DEFAULT_TASK_TYPES, DEFAULT_IMPACTS } from "../src/lib/types";
import {
  matchesTaskFilters,
  UNASSIGNED_FILTER,
  validFilterIds,
} from "../src/lib/task-filters";

async function project(repo: SqliteRepository, name = "Categorías") {
  const projectId = (
    await repo.execute(
      {
        type: "project.create",
        name,
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
    featureId: workspace.features.find(
      (feature) => feature.projectId === projectId,
    )!.id,
    statusId: workspace.statuses.find(
      (status) => status.projectId === projectId,
    )!.id,
    title: "Tarea opcional",
    description: "Conservar descripción",
    priority: "medium",
    dueDate: null,
    labels: [],
  };
  return { projectId, fields, workspace };
}

test("los proyectos reciben los catálogos por defecto y las tareas admiten omisión, asignación y limpieza independiente", async () => {
  const repo = await createRepository();
  try {
    const { fields, workspace } = await project(repo);
    assert.deepEqual(
      workspace.taskTypes.map(({ name, color }) => ({ name, color })),
      [...DEFAULT_TASK_TYPES],
    );
    assert.deepEqual(
      workspace.impacts.map(({ name, color }) => ({ name, color })),
      [...DEFAULT_IMPACTS],
    );
    const { createdId: id } = await repo.execute(
      commandSchema.parse({ type: "task.create", ...fields }),
      actor,
    );
    let task = (await repo.getWorkspace(actor)).tasks[0];
    assert.deepEqual([task.typeId, task.impactId], [null, null]);
    const typeId = workspace.taskTypes[0].id,
      impactId = workspace.impacts[0].id;
    await repo.execute(
      commandSchema.parse({
        type: "task.update",
        id,
        ...fields,
        typeId,
        impactId,
      }),
      actor,
    );
    await repo.execute(
      commandSchema.parse({
        type: "task.update",
        id,
        ...fields,
        title: "Actualizada",
      }),
      actor,
    );
    task = (await repo.getWorkspace(actor)).tasks[0];
    assert.deepEqual([task.typeId, task.impactId], [typeId, impactId]);
    await repo.execute(
      commandSchema.parse({ type: "task.update", id, ...fields, typeId: null }),
      actor,
    );
    task = (await repo.getWorkspace(actor)).tasks[0];
    assert.deepEqual([task.typeId, task.impactId], [null, impactId]);
    await repo.execute(
      commandSchema.parse({
        type: "task.update",
        id,
        ...fields,
        impactId: null,
      }),
      actor,
    );
    assert.equal((await repo.getWorkspace(actor)).tasks[0].impactId, null);
    for (const field of ["typeId", "impactId"]) {
      for (const value of ["", 123, []])
        assert.equal(
          commandSchema.safeParse({
            type: "task.create",
            ...fields,
            [field]: value,
          }).success,
          false,
        );
    }
  } finally {
    await repo.close();
  }
});

for (const [kind, catalog, field] of [
  ["taskType", "taskTypes", "typeId"],
  ["impact", "impacts", "impactId"],
] as const) {
  test(`${kind}: configuración aislada, permisos y protección de opciones usadas por tareas archivadas`, async () => {
    const repo = await createRepository();
    try {
      const { projectId, fields } = await project(repo);
      const other = await project(repo, "Otro proyecto");
      const member = await addUser(repo, `member-${kind}`);
      await repo.execute(
        { type: "project.member.add", projectId, userId: member.id },
        actor,
      );
      const create = {
        type: `${kind}.create`,
        projectId,
        name: "Personalizada",
        color: "#123456",
      };
      const id = (await repo.execute(commandSchema.parse(create), actor))
        .createdId!;
      await assert.rejects(
        repo.execute(
          commandSchema.parse({ ...create, name: "personalizada" }),
          actor,
        ),
        /Ya existe/,
      );
      await assert.rejects(
        repo.execute(
          commandSchema.parse({ ...create, name: "Prohibida" }),
          member,
        ),
        /propietario/,
      );
      await assert.rejects(
        repo.execute(
          commandSchema.parse({
            type: "task.create",
            ...other.fields,
            [field]: id,
          }),
          actor,
        ),
        /pertenecer al proyecto/,
      );
      await assert.rejects(
        repo.execute(
          commandSchema.parse({
            type: "task.create",
            ...fields,
            [field]: "inexistente",
          }),
          actor,
        ),
        /pertenecer al proyecto/,
      );
      await assert.rejects(
        repo.execute(
          commandSchema.parse({
            type: `${kind}.update`,
            projectId: other.projectId,
            id,
            name: "Ajena",
            color: "#ffffff",
          }),
          actor,
        ),
        /no pertenece/,
      );
      await assert.rejects(
        repo.execute(
          commandSchema.parse({
            type: `${kind}.delete`,
            projectId: other.projectId,
            id,
          }),
          actor,
        ),
        /no pertenece/,
      );
      const taskId = (
        await repo.execute(
          commandSchema.parse({ type: "task.create", ...fields, [field]: id }),
          member,
        )
      ).createdId!;
      await repo.execute(
        commandSchema.parse({
          type: `${kind}.update`,
          projectId,
          id,
          name: "Renombrada",
          color: "#abcdef",
        }),
        actor,
      );
      let workspace = await repo.getWorkspace(actor);
      assert.equal(
        workspace[catalog].find((option) => option.id === id)?.name,
        "Renombrada",
      );
      assert.equal(
        workspace[catalog].find((option) => option.id === id)?.color,
        "#abcdef",
      );
      assert.equal(workspace.tasks[0][field], id);
      await assert.rejects(
        repo.execute(
          commandSchema.parse({ type: `${kind}.delete`, projectId, id }),
          member,
        ),
        /propietario/,
      );
      await assert.rejects(
        repo.execute(
          commandSchema.parse({ type: `${kind}.delete`, projectId, id }),
          actor,
        ),
        /tareas/,
      );
      await repo.execute(
        { type: "task.archive", id: taskId, archived: true },
        actor,
      );
      await assert.rejects(
        repo.execute(
          commandSchema.parse({ type: `${kind}.delete`, projectId, id }),
          actor,
        ),
        /archivadas/,
      );
      await repo.execute(
        commandSchema.parse({
          type: "task.update",
          id: taskId,
          ...fields,
          [field]: null,
        }),
        member,
      );
      workspace = await repo.getWorkspace(actor);
      for (const option of workspace[catalog].filter(
        (option) => option.projectId === projectId,
      ))
        await repo.execute(
          commandSchema.parse({
            type: `${kind}.delete`,
            projectId,
            id: option.id,
          }),
          actor,
        );
      assert.equal(
        (await repo.getWorkspace(actor))[catalog].filter(
          (option) => option.projectId === projectId,
        ).length,
        0,
      );
      const privateActor = await addUser(repo, `private-${kind}`);
      assert.equal((await repo.getWorkspace(privateActor))[catalog].length, 0);
      await repo.execute(
        { type: "project.delete", id: other.projectId },
        actor,
      );
      assert.equal((await repo.getWorkspace(actor))[catalog].length, 0);
      assert.deepEqual(repo.db.prepare("PRAGMA foreign_key_check").all(), []);
    } finally {
      await repo.close();
    }
  });
}

test("el despliegue migra proyectos existentes sin cambiar tareas ni relaciones, y el backfill no se repite", async () => {
  const directory = await mkdtemp(join(tmpdir(), "brote-categories-"));
  const path = join(directory, "legacy.sqlite");
  let repo = await createRepository(path);
  try {
    const { projectId, fields } = await project(repo);
    await project(repo, "Proyecto vacío");
    const taskId = (
      await repo.execute({ type: "task.create", ...fields }, actor)
    ).createdId!;
    await repo.execute(
      { type: "comment.create", taskId, content: "Conservar comentario" },
      actor,
    );
    const checklistId = (
      await repo.execute(
        { type: "checklist.create", taskId, title: "Conservar checklist" },
        actor,
      )
    ).createdId!;
    await repo.execute(
      { type: "checklist.item.create", checklistId, title: "Conservar ítem" },
      actor,
    );
    const nextStatus = (await repo.getWorkspace(actor)).statuses.find(
      (status) =>
        status.projectId === projectId && status.id !== fields.statusId,
    )!;
    await repo.execute(
      {
        type: "task.move",
        id: taskId,
        statusId: nextStatus.id,
        beforeId: null,
      },
      actor,
    );
    await repo.execute(
      { type: "task.archive", id: taskId, archived: true },
      actor,
    );
    const before = await repo.getWorkspace(actor);
    await repo.close();
    const legacy = new DatabaseSync(path);
    try {
      legacy.exec(
        "ALTER TABLE tasks DROP COLUMN typeId; ALTER TABLE tasks DROP COLUMN impactId; ALTER TABLE tasks DROP COLUMN ticketNumber; DROP TABLE task_types; DROP TABLE impacts; DELETE FROM __drizzle_migrations WHERE created_at>(SELECT MIN(created_at) FROM __drizzle_migrations);",
      );
    } finally {
      legacy.close();
    }
    repo = new SqliteRepository(path);
    const migrated = await repo.getWorkspace(actor);
    assert.deepEqual(migrated.tasks, before.tasks);
    assert.deepEqual(migrated.projects, before.projects);
    assert.deepEqual(migrated.features, before.features);
    for (const project of migrated.projects) {
      assert.deepEqual(
        migrated.taskTypes
          .filter((option) => option.projectId === project.id)
          .map(({ name, color }) => ({ name, color })),
        [...DEFAULT_TASK_TYPES],
      );
      assert.deepEqual(
        migrated.impacts
          .filter((option) => option.projectId === project.id)
          .map(({ name, color }) => ({ name, color })),
        [...DEFAULT_IMPACTS],
      );
    }
    assert.deepEqual(repo.db.prepare("PRAGMA foreign_key_check").all(), []);
    const option = migrated.taskTypes[0];
    await repo.execute(
      { type: "taskType.delete", projectId: option.projectId, id: option.id },
      actor,
    );
    const customized = await repo.getWorkspace(actor);
    await repo.close();
    repo = new SqliteRepository(path);
    assert.deepEqual(await repo.getWorkspace(actor), customized);
    assert.equal(
      repo.db.prepare("SELECT COUNT(*) AS n FROM __drizzle_migrations").get()
        ?.n,
      3,
    );
  } finally {
    await repo.close();
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 50,
    });
  }
});

test("el ticket es opcional, conserva ceros y referencias, y las actualizaciones anteriores no lo borran", async () => {
  const repo = await createRepository();
  try {
    const { fields } = await project(repo);
    const id = (await repo.execute({ type: "task.create", ...fields }, actor))
      .createdId!;
    assert.equal((await repo.getWorkspace(actor)).tasks[0].ticketNumber, null);
    for (const value of ["001234", " ABC-00042 "]) {
      await repo.execute(
        commandSchema.parse({
          type: "task.update",
          id,
          ...fields,
          ticketNumber: value,
        }),
        actor,
      );
      await repo.execute({ type: "task.update", id, ...fields }, actor);
      assert.equal(
        (await repo.getWorkspace(actor)).tasks[0].ticketNumber,
        value.trim(),
      );
    }
    for (const ticketNumber of [null, "", "   "]) {
      await repo.execute(
        commandSchema.parse({
          type: "task.update",
          id,
          ...fields,
          ticketNumber,
        }),
        actor,
      );
      assert.equal(
        (await repo.getWorkspace(actor)).tasks[0].ticketNumber,
        null,
      );
    }
    for (const ticketNumber of [123, [], "a".repeat(101)])
      assert.equal(
        commandSchema.safeParse({
          type: "task.create",
          ...fields,
          ticketNumber,
        }).success,
        false,
      );
  } finally {
    await repo.close();
  }
});

test("la migración añade emojis y ticket vacío conservando IDs, tareas, colores, nombres personalizados y opciones en conflicto", async () => {
  const directory = await mkdtemp(join(tmpdir(), "brote-emojis-test-"));
  const path = join(directory, "workspace.sqlite");
  let repo = await createRepository(path);
  try {
    const { fields, projectId, workspace } = await project(repo);
    const typeId = workspace.taskTypes[0].id,
      impactId = workspace.impacts[0].id;
    const taskId = (
      await repo.execute(
        { type: "task.create", ...fields, typeId, impactId },
        actor,
      )
    ).createdId!;
    await repo.execute(
      { type: "task.archive", id: taskId, archived: true },
      actor,
    );
    for (const [table, options] of [
      ["task_types", workspace.taskTypes],
      ["impacts", workspace.impacts],
    ] as const)
      for (const option of options)
        repo.db
          .prepare(`UPDATE ${table} SET name=? WHERE id=?`)
          .run(option.name.slice(option.name.indexOf(" ") + 1), option.id);
    repo.db
      .prepare(
        "UPDATE task_types SET name='Solicitud especial',color='#123456' WHERE id=?",
      )
      .run(workspace.taskTypes[1].id);
    repo.db
      .prepare(
        "UPDATE impacts SET name='Cliente VIP',color='#654321' WHERE id=?",
      )
      .run(workspace.impacts[1].id);
    const duplicateId = (
      await repo.execute(
        {
          type: "taskType.create",
          projectId,
          name: "🐛 Error",
          color: "#112233",
        },
        actor,
      )
    ).createdId!;
    const before = await repo.getWorkspace(actor);
    await repo.close();
    const legacy = new DatabaseSync(path);
    try {
      legacy.exec(
        "ALTER TABLE tasks DROP COLUMN ticketNumber; DELETE FROM __drizzle_migrations WHERE created_at=(SELECT MAX(created_at) FROM __drizzle_migrations);",
      );
    } finally {
      legacy.close();
    }
    repo = new SqliteRepository(path);
    const migrated = await repo.getWorkspace(actor);
    assert.deepEqual(migrated.tasks, before.tasks);
    assert.deepEqual(
      migrated.taskTypes.map((option) => option.id),
      before.taskTypes.map((option) => option.id),
    );
    assert.equal(
      migrated.taskTypes.find((option) => option.id === typeId)?.name,
      "💡 Sugerencia",
    );
    assert.equal(
      migrated.impacts.find((option) => option.id === impactId)?.name,
      "👤 Usuario",
    );
    assert.equal(
      migrated.taskTypes.find(
        (option) => option.id === workspace.taskTypes[1].id,
      )?.name,
      "Solicitud especial",
    );
    assert.equal(
      migrated.taskTypes.find(
        (option) => option.id === workspace.taskTypes[1].id,
      )?.color,
      "#123456",
    );
    assert.equal(
      migrated.impacts.find((option) => option.id === workspace.impacts[1].id)
        ?.name,
      "Cliente VIP",
    );
    assert.equal(
      migrated.impacts.find((option) => option.id === workspace.impacts[1].id)
        ?.color,
      "#654321",
    );
    assert.equal(
      migrated.taskTypes.find(
        (option) => option.id === workspace.taskTypes[3].id,
      )?.name,
      "Error",
    );
    assert.equal(
      migrated.taskTypes.find((option) => option.id === duplicateId)?.name,
      "🐛 Error",
    );
    assert.deepEqual(repo.db.prepare("PRAGMA foreign_key_check").all(), []);
    await repo.execute(
      {
        type: "taskType.update",
        projectId,
        id: typeId,
        name: "Sugerencia",
        color: "#334455",
      },
      actor,
    );
    const customized = await repo.getWorkspace(actor);
    await repo.close();
    repo = new SqliteRepository(path);
    assert.deepEqual(await repo.getWorkspace(actor), customized);
  } finally {
    await repo.close();
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 12,
      retryDelay: 50,
    });
  }
});

test("los filtros combinan categorías, admiten múltiples valores y tareas sin clasificación, e ignoran opciones eliminadas", () => {
  const task = { statusId: "pending", typeId: "error", impactId: "client" };
  const all = { statusIds: [], typeIds: [], impactIds: [] };
  assert.equal(matchesTaskFilters(task, all), true);
  assert.equal(
    matchesTaskFilters(task, {
      statusIds: ["pending"],
      typeIds: ["suggestion", "error"],
      impactIds: ["client"],
    }),
    true,
  );
  for (const filters of [
    { ...all, statusIds: ["done"] },
    { ...all, typeIds: ["suggestion"] },
    { ...all, impactIds: ["user"] },
  ])
    assert.equal(matchesTaskFilters(task, filters), false);
  const optional = { ...task, typeId: null, impactId: null };
  assert.equal(
    matchesTaskFilters(optional, {
      ...all,
      typeIds: [UNASSIGNED_FILTER],
      impactIds: [UNASSIGNED_FILTER],
    }),
    true,
  );
  assert.equal(
    matchesTaskFilters(task, { ...all, typeIds: [UNASSIGNED_FILTER, "error"] }),
    true,
  );
  assert.equal(
    matchesTaskFilters(optional, { ...all, typeIds: ["error"] }),
    false,
  );
  assert.equal(
    matchesTaskFilters(optional, { ...all, impactIds: ["client"] }),
    false,
  );
  assert.deepEqual(
    validFilterIds(
      ["error", "deleted", "other-project", "error", UNASSIGNED_FILTER],
      [{ id: "error" }],
      true,
    ),
    ["error", UNASSIGNED_FILTER],
  );
  assert.deepEqual(validFilterIds([UNASSIGNED_FILTER], [], false), []);
});
