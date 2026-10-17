import { assertIntegrity } from "./postgres-fixture";
import { actor, createRepository } from "./helpers";
import { test } from "node:test";
import assert from "node:assert/strict";
import { PostgresRepository } from "../src/server/postgres";
async function project(repo: PostgresRepository) {
  return (
    await repo.execute(
      {
        type: "project.create",
        name: "Proyecto",
        description: "",
        icon: "🌱",
        color: "#059669",
      },
      actor,
    )
  ).createdId!;
}
async function module(repo: PostgresRepository, projectId: string) {
  return (
    await repo.execute(
      {
        type: "module.create",
        projectId,
        name: "Módulo",
        description: "",
      },
      actor,
    )
  ).createdId!;
}
async function feature(
  repo: PostgresRepository,
  projectId: string,
  moduleId: string | null,
) {
  return (
    await repo.execute(
      {
        type: "feature.create",
        projectId,
        moduleId,
        name: "Feature",
        description: "",
      },
      actor,
    )
  ).createdId!;
}
async function number(repo: PostgresRepository, id: string) {
  return (await repo.getWorkspace(actor)).features.find(
    (feature) => feature.id === id,
  )!.number;
}
async function move(
  repo: PostgresRepository,
  id: string,
  moduleId: string | null,
) {
  await repo.execute(
    { type: "feature.update", id, moduleId, name: "Feature", description: "" },
    actor,
  );
}
test("los números son independientes por módulo y proyecto, y los movimientos y altas rellenan el primer hueco", async () => {
  const repo = await createRepository();
  try {
    const p = await project(repo);
    const a = await module(repo, p);
    const b = await module(repo, p);
    const other = await project(repo);
    const otherModule = await module(repo, other);
    const source = await feature(repo, p, a);
    const first = await feature(repo, p, b);
    const hole = await feature(repo, p, b);
    const last = await feature(repo, p, b);
    const foreign = await feature(repo, other, otherModule);
    assert.deepEqual(
      await Promise.all(
        [source, first, hole, last, foreign].map(
          async (id) => await number(repo, id),
        ),
      ),
      [1, 1, 2, 3, 1],
    );
    await repo.execute({ type: "feature.delete", id: hole }, actor);
    const before = await repo.getWorkspace(actor);
    await move(repo, source, b);
    assert.equal(await number(repo, source), 2);
    assert.deepEqual(
      (await repo.getWorkspace(actor)).features.filter((f) => f.id !== source),
      before.features.filter((f) => f.id !== source),
    );
    assert.equal(await number(repo, await feature(repo, p, a)), 1);
    await move(repo, first, a);
    assert.equal(await number(repo, first), 2);
    const newFirst = await feature(repo, p, b);
    assert.equal(await number(repo, newFirst), 1);
    const general = (await repo.getWorkspace(actor)).features.find(
      (f) => f.projectId === p && f.moduleId === null,
    )!;
    await repo.execute({ type: "feature.delete", id: general.id }, actor);
    await move(repo, source, null);
    assert.equal(await number(repo, source), 1);
    await move(repo, first, b);
    assert.equal(await number(repo, first), 2);
    await repo.execute({ type: "feature.pin", id: first, pinned: true }, actor);
    await repo.execute(
      {
        type: "feature.update",
        id: first,
        name: "Editada",
        description: "Sin mover",
      },
      actor,
    );
    const saved = (await repo.getWorkspace(actor)).features;
    await repo.execute(
      {
        type: "feature.reorder",
        projectId: p,
        ids: saved
          .filter((f) => f.projectId === p)
          .map((f) => f.id)
          .reverse(),
      },
      actor,
    );
    for (const f of saved) assert.equal(await number(repo, f.id), f.number);
    await move(repo, first, b);
    assert.equal(await number(repo, first), 2);
    await assert.rejects(
      repo.store.pool.query("UPDATE features SET number=1 WHERE id=$1", [
        first,
      ]),
      /unique constraint/,
    );
    await assertIntegrity(repo);
  } finally {
    await repo.close();
  }
});
test("eliminar un módulo asigna los huecos de General sin colisiones y permite eliminar el proyecto completo", async () => {
  const repo = await createRepository();
  try {
    const p = await project(repo);
    const a = await module(repo, p);
    const hole = await feature(repo, p, null);
    const general = await feature(repo, p, null);
    const first = await feature(repo, p, a);
    const second = await feature(repo, p, a);
    await repo.execute({ type: "feature.delete", id: hole }, actor);
    await repo.execute({ type: "module.delete", id: a }, actor);
    assert.deepEqual(
      await Promise.all(
        [general, first, second].map(async (id) => await number(repo, id)),
      ),
      [3, 2, 4],
    );
    assert.ok(
      (await repo.getWorkspace(actor)).features.every(
        (f) => f.moduleId === null,
      ),
    );
    const another = await module(repo, p);
    await feature(repo, p, another);
    await repo.execute({ type: "project.delete", id: p }, actor);
    assert.deepEqual((await repo.getWorkspace(actor)).features, []);
    await assertIntegrity(repo);
  } finally {
    await repo.close();
  }
});
