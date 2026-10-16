import { actor, createRepository } from "./helpers";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SqliteRepository } from "../src/server/sqlite";
import { commandSchema } from "../src/lib/validation";
async function project(repo: SqliteRepository, name = "Proyecto") {
  return (
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
}
async function module(repo: SqliteRepository, projectId: string, name: string) {
  return (
    await repo.execute(
      {
        type: "module.create",
        projectId,
        name,
        description: `Descripción de ${name}`,
      },
      actor,
    )
  ).createdId!;
}
test("el módulo es opcional y cambiarlo asigna un número del destino conservando tareas, posición y fijadas", async () => {
  const repo = await createRepository(":memory:", false);
  try {
    const projectId = await project(repo);
    const a = await module(repo, projectId, "Administración");
    const b = await module(repo, projectId, "Comunicaciones");
    const first = (await repo.getWorkspace(actor)).features[0];
    assert.equal(first.moduleId, null);
    const second = (
      await repo.execute(
        commandSchema.parse({
          type: "feature.create",
          projectId,
          name: "Usuarios",
          moduleId: a,
        }),
        actor,
      )
    ).createdId!;
    const third = (
      await repo.execute(
        commandSchema.parse({
          type: "feature.create",
          projectId,
          name: "Mensajes",
          moduleId: b,
        }),
        actor,
      )
    ).createdId!;
    const fourth = (
      await repo.execute(
        commandSchema.parse({
          type: "feature.create",
          projectId,
          name: "Sin módulo",
        }),
        actor,
      )
    ).createdId!;
    const before = (await repo.getWorkspace(actor)).features;
    assert.deepEqual(
      before.map((feature) => feature.position),
      [0, 1, 2, 3],
    );
    assert.deepEqual(
      before.map((feature) => feature.moduleId),
      [null, a, b, null],
    );
    assert.deepEqual(
      before.map((feature) => feature.number),
      [1, 1, 1, 2],
    );
    await repo.execute(
      { type: "feature.pin", id: second, pinned: true },
      actor,
    );
    await repo.execute(
      {
        type: "task.create",
        projectId,
        featureId: second,
        statusId: (await repo.getWorkspace(actor)).statuses[0].id,
        title: "Conservar tarea",
        description: "",
        priority: "medium",
        dueDate: null,
        labels: [],
      },
      actor,
    );
    const tasks = (await repo.getWorkspace(actor)).tasks;
    await repo.execute(
      {
        type: "feature.update",
        id: second,
        name: "Usuarios",
        description: "",
        moduleId: b,
      },
      actor,
    );
    let saved = await repo.getWorkspace(actor);
    assert.equal(
      saved.features.find((feature) => feature.id === second)?.moduleId,
      b,
    );
    assert.equal(
      saved.features.find((feature) => feature.id === second)?.pinned,
      true,
    );
    assert.equal(
      saved.features.find((feature) => feature.id === second)?.number,
      2,
    );
    assert.deepEqual(
      saved.features.map((feature) => [feature.id, feature.position]),
      before.map((feature) => [feature.id, feature.position]),
    );
    // Older clients that omit moduleId must not move the feature to General.
    await repo.execute(
      commandSchema.parse({
        type: "feature.update",
        id: second,
        name: "Usuarios editados",
      }),
      actor,
    );
    assert.equal(
      (await repo.getWorkspace(actor)).features.find(
        (feature) => feature.id === second,
      )?.moduleId,
      b,
    );
    await repo.execute(
      {
        type: "feature.update",
        id: third,
        name: "Mensajes",
        description: "",
        moduleId: null,
      },
      actor,
    );
    saved = await repo.getWorkspace(actor);
    assert.equal(
      saved.features.find((feature) => feature.id === third)?.moduleId,
      null,
    );
    assert.equal(
      saved.features.find((feature) => feature.id === third)?.number,
      3,
    );
    assert.equal(
      saved.features.find((feature) => feature.id === fourth)?.moduleId,
      null,
    );
    assert.deepEqual(saved.tasks, tasks);
    assert.deepEqual(repo.db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    await repo.close();
  }
});
test("no se asignan módulos de otro proyecto o inexistentes y los errores no modifican datos", async () => {
  const repo = await createRepository(":memory:", false);
  try {
    const a = await project(repo);
    const b = await project(repo, "Otro");
    const foreignModule = await module(repo, b, "Ajeno");
    const feature = (await repo.getWorkspace(actor)).features.find(
      (feature) => feature.projectId === a,
    )!;
    const before = await repo.getWorkspace(actor);
    for (const moduleId of [foreignModule, "inexistente"]) {
      await assert.rejects(
        async () =>
          await repo.execute(
            {
              type: "feature.create",
              projectId: a,
              name: "Inválida",
              description: "",
              moduleId,
            },
            actor,
          ),
        /módulo|ya no existe/,
      );
      await assert.rejects(
        async () =>
          await repo.execute(
            {
              type: "feature.update",
              id: feature.id,
              name: "No guardar",
              description: "",
              moduleId,
            },
            actor,
          ),
        /módulo|ya no existe/,
      );
      assert.deepEqual(await repo.getWorkspace(actor), before);
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
    await repo.close();
  }
});
test("editar y ordenar módulos conserva el orden de features y rechaza órdenes incompletos o ajenos", async () => {
  const repo = await createRepository(":memory:", false);
  try {
    const projectId = await project(repo);
    const a = await module(repo, projectId, "Uno");
    const b = await module(repo, projectId, "Dos");
    const c = await module(repo, await project(repo, "Otro"), "Ajeno");
    await repo.execute(
      {
        type: "module.update",
        id: a,
        name: "Administración",
        description: "Descripción nueva",
      },
      actor,
    );
    await repo.execute(
      { type: "module.reorder", projectId, ids: [b, a] },
      actor,
    );
    const before = await repo.getWorkspace(actor);
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
      await assert.rejects(
        async () =>
          await repo.execute({ type: "module.reorder", projectId, ids }, actor),
        /lista de módulos/,
      );
      assert.deepEqual(await repo.getWorkspace(actor), before);
    }
  } finally {
    await repo.close();
  }
});
test("eliminar un módulo pasa sus features a General y conserva tareas archivadas y relaciones", async () => {
  const repo = await createRepository(":memory:", false);
  try {
    const projectId = await project(repo);
    const id = await module(repo, projectId, "Eliminar");
    const feature = (await repo.getWorkspace(actor)).features[0];
    await repo.execute(
      {
        type: "feature.update",
        id: feature.id,
        name: feature.name,
        description: "",
        moduleId: id,
      },
      actor,
    );
    const taskId = (
      await repo.execute(
        {
          type: "task.create",
          projectId,
          featureId: feature.id,
          statusId: (await repo.getWorkspace(actor)).statuses[0].id,
          title: "Archivada",
          description: "",
          priority: "medium",
          dueDate: null,
          labels: [],
        },
        actor,
      )
    ).createdId!;
    await repo.execute(
      { type: "task.archive", id: taskId, archived: true },
      actor,
    );
    await repo.execute(
      { type: "comment.create", taskId, content: "Conservar" },
      actor,
    );
    const before = await repo.getWorkspace(actor);
    await repo.execute({ type: "module.delete", id }, actor);
    assert.deepEqual(
      (await repo.getWorkspace(actor)).features,
      before.features.map((feature) => ({ ...feature, moduleId: null })),
    );
    assert.deepEqual((await repo.getWorkspace(actor)).tasks, before.tasks);
    assert.deepEqual((await repo.getWorkspace(actor)).modules, []);
    await module(repo, projectId, "Cascada");
    await repo.execute({ type: "project.delete", id: projectId }, actor);
    assert.deepEqual((await repo.getWorkspace(actor)).modules, []);
    assert.deepEqual(repo.db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    await repo.close();
  }
});
