import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SqliteRepository } from "../src/server/sqlite";

function project(repo: SqliteRepository) {
  return repo.execute({
    type: "project.create", name: "Proyecto", description: "",
    icon: "🌱", color: "#059669",
  }).createdId!;
}
function module(repo: SqliteRepository, projectId: string) {
  return repo.execute({
    type: "module.create", projectId, name: "Módulo", description: "",
  }).createdId!;
}
function feature(repo: SqliteRepository, projectId: string, moduleId: string | null) {
  return repo.execute({
    type: "feature.create", projectId, moduleId, name: "Feature", description: "",
  }).createdId!;
}
function number(repo: SqliteRepository, id: string) {
  return repo.getWorkspace().features.find((feature) => feature.id === id)!.number;
}
function move(repo: SqliteRepository, id: string, moduleId: string | null) {
  repo.execute({ type: "feature.update", id, moduleId, name: "Feature", description: "" });
}
function downgradeToV6(db: DatabaseSync) {
  db.exec("DROP INDEX feature_number; ALTER TABLE features DROP COLUMN number; PRAGMA user_version=6;");
}

test("los números son independientes por módulo y proyecto, y los movimientos y altas rellenan el primer hueco", () => {
  const repo = new SqliteRepository(":memory:", false);
  try {
    const p = project(repo);
    const a = module(repo, p);
    const b = module(repo, p);
    const other = project(repo);
    const otherModule = module(repo, other);
    const source = feature(repo, p, a);
    const first = feature(repo, p, b);
    const hole = feature(repo, p, b);
    const last = feature(repo, p, b);
    const foreign = feature(repo, other, otherModule);
    assert.deepEqual([source, first, hole, last, foreign].map((id) => number(repo, id)), [1, 1, 2, 3, 1]);

    repo.execute({ type: "feature.delete", id: hole });
    const before = repo.getWorkspace();
    move(repo, source, b);
    assert.equal(number(repo, source), 2);
    assert.deepEqual(repo.getWorkspace().features.filter((f) => f.id !== source), before.features.filter((f) => f.id !== source));
    assert.equal(number(repo, feature(repo, p, a)), 1);

    move(repo, first, a);
    assert.equal(number(repo, first), 2);
    const newFirst = feature(repo, p, b);
    assert.equal(number(repo, newFirst), 1);
    const general = repo.getWorkspace().features.find((f) => f.projectId === p && f.moduleId === null)!;
    repo.execute({ type: "feature.delete", id: general.id });
    move(repo, source, null);
    assert.equal(number(repo, source), 1);
    move(repo, first, b);
    assert.equal(number(repo, first), 2);

    repo.execute({ type: "feature.pin", id: first, pinned: true });
    repo.execute({ type: "feature.update", id: first, name: "Editada", description: "Sin mover" });
    const saved = repo.getWorkspace().features;
    repo.execute({ type: "feature.reorder", projectId: p, ids: saved.filter((f) => f.projectId === p).map((f) => f.id).reverse() });
    for (const f of saved) assert.equal(number(repo, f.id), f.number);
    move(repo, first, b);
    assert.equal(number(repo, first), 2);
    assert.throws(() => repo.db.prepare("UPDATE features SET number=1 WHERE id=?").run(first), /UNIQUE/);
    assert.deepEqual(repo.db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    repo.close();
  }
});

test("eliminar un módulo asigna los huecos de General sin colisiones y permite eliminar el proyecto completo", () => {
  const repo = new SqliteRepository(":memory:", false);
  try {
    const p = project(repo);
    const a = module(repo, p);
    const hole = feature(repo, p, null);
    const general = feature(repo, p, null);
    const first = feature(repo, p, a);
    const second = feature(repo, p, a);
    repo.execute({ type: "feature.delete", id: hole });
    repo.execute({ type: "module.delete", id: a });
    assert.deepEqual([general, first, second].map((id) => number(repo, id)), [3, 2, 4]);
    assert.ok(repo.getWorkspace().features.every((f) => f.moduleId === null));
    const another = module(repo, p);
    feature(repo, p, another);
    repo.execute({ type: "project.delete", id: p });
    assert.deepEqual(repo.getWorkspace().features, []);
    assert.deepEqual(repo.db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    repo.close();
  }
});

test("migrar v6 renumera en el orden existente de cada módulo sin modificar el resto del espacio", async () => {
  const dir = await mkdtemp(join(tmpdir(), "brote-feature-numbering-"));
  const path = join(dir, "workspace.sqlite");
  let repo = new SqliteRepository(path, true);
  try {
    const p = repo.getWorkspace().projects[0].id;
    const a = module(repo, p);
    const b = module(repo, p);
    const first = feature(repo, p, a);
    feature(repo, p, b);
    const second = feature(repo, p, a);
    feature(repo, p, null);
    const other = project(repo);
    feature(repo, other, null);
    repo.execute({ type: "feature.pin", id: second, pinned: true });
    repo.execute({ type: "feature.reorder", projectId: p, ids: repo.getWorkspace().features.filter((f) => f.projectId === p).map((f) => f.id).reverse() });
    const before = repo.getWorkspace();
    const counters = new Map<string, number>();
    const expected = {
      ...before,
      features: before.features.map((f) => {
        const key = JSON.stringify([f.projectId, f.moduleId]);
        const number = (counters.get(key) ?? 0) + 1;
        counters.set(key, number);
        return { ...f, number };
      }),
    };
    repo.close();
    const legacy = new DatabaseSync(path);
    downgradeToV6(legacy);
    legacy.close();
    repo = new SqliteRepository(path, true);
    assert.equal(repo.db.prepare("PRAGMA user_version").get()?.user_version, 7);
    assert.deepEqual(repo.getWorkspace(), expected);
    assert.equal(number(repo, second), 1);
    assert.equal(number(repo, first), 2);
    repo.execute({ type: "feature.delete", id: second });
    const saved = repo.getWorkspace();
    const backup = join(dir, "backup.sqlite");
    await repo.exportBackup(backup);
    repo.close();
    repo = new SqliteRepository(path, false);
    assert.deepEqual(repo.getWorkspace(), saved);
    move(repo, first, b);
    await repo.restoreBackup(backup);
    assert.deepEqual(repo.getWorkspace(), saved);
    assert.equal(number(repo, first), 2);
    assert.equal(number(repo, feature(repo, p, a)), 1);
    assert.deepEqual(repo.db.prepare("PRAGMA foreign_key_check").all(), []);
    assert.equal(repo.db.prepare("PRAGMA integrity_check").get()?.integrity_check, "ok");
  } finally {
    repo.close();
    await rm(dir, { recursive: true, force: true });
  }
});
