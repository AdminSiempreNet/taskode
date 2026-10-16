import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteRepository } from "../src/server/sqlite";
import { BackupManager } from "../src/server/backups";
import { GET as list, POST as create } from "../src/app/api/backups/route";
import {
  GET as download,
  DELETE as remove,
} from "../src/app/api/backups/[id]/route";
import { POST as restore } from "../src/app/api/backups/restore/route";

const base = "http://localhost:5010";
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "brote-backup-http-"));
  const path = join(dir, "workspace.sqlite");
  const repo = new SqliteRepository(path, false);
  const manager = new BackupManager(repo, path);
  Object.assign(globalThis, { broteRepository: repo, broteBackups: manager });
  return {
    repo,
    manager,
    async cleanup() {
      Reflect.deleteProperty(globalThis, "broteRepository");
      Reflect.deleteProperty(globalThis, "broteBackups");
      repo.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
function formRequest(form: FormData) {
  return new Request(base + "/api/backups/restore", {
    method: "POST",
    body: form,
  });
}

test("API de respaldos: lista, genera, descarga y elimina con nombres seguros", async () => {
  const s = await setup();
  try {
    assert.deepEqual(await (await list()).json(), { backups: [] });
    const response = await create(
      new Request(base + "/api/backups", { method: "POST" }),
    );
    assert.equal(response.status, 201);
    const { backup } = await response.json();
    const context = { params: Promise.resolve({ id: backup.id }) };
    const file = await download(new Request(base), context);
    assert.equal(file.status, 200);
    assert.equal(file.headers.get("cache-control"), "no-store");
    assert.match(
      file.headers.get("content-disposition")!,
      /attachment; filename="brote-/,
    );
    assert.equal(
      Buffer.from(await file.arrayBuffer())
        .subarray(0, 16)
        .toString(),
      "SQLite format 3\0",
    );
    assert.equal((await (await list()).json()).backups.length, 1);
    assert.equal(
      (await remove(new Request(base, { method: "DELETE" }), context)).status,
      204,
    );
    assert.equal((await download(new Request(base), context)).status, 404);
    assert.equal(
      (
        await remove(new Request(base, { method: "DELETE" }), {
          params: Promise.resolve({ id: "../workspace.sqlite" }),
        })
      ).status,
      404,
    );
  } finally {
    await s.cleanup();
  }
});

test("API de restauración: exige confirmación y opción previa; valida multipart, origen y límite de carga", async () => {
  const s = await setup();
  try {
    const foreign = { origin: "https://otro-sitio.example" };
    assert.equal(
      (await create(new Request(base, { method: "POST", headers: foreign })))
        .status,
      403,
    );
    assert.equal(
      (
        await remove(
          new Request(base, { method: "DELETE", headers: foreign }),
          { params: Promise.resolve({ id: "missing" }) },
        )
      ).status,
      403,
    );
    assert.equal(
      (await restore(new Request(base, { method: "POST", headers: foreign })))
        .status,
      403,
    );
    assert.equal(
      (
        await restore(
          new Request(base, { method: "POST", body: "not multipart" }),
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await restore(
          new Request(base, {
            method: "POST",
            headers: { "content-length": String(102 * 1024 * 1024) },
            body: "x",
          }),
        )
      ).status,
      413,
    );
    const backup = await s.manager.create();
    const form = new FormData();
    form.set("backupId", backup.id);
    form.set("backupBeforeRestore", "true");
    form.set("confirmation", "restaurar");
    assert.equal((await restore(formRequest(form))).status, 400);
    form.set("confirmation", "RESTAURAR");
    form.delete("backupBeforeRestore");
    assert.equal((await restore(formRequest(form))).status, 400);
    form.set("backupBeforeRestore", "false");
    form.set("file", new File(["invalid"], "invalid.sqlite"));
    assert.equal((await restore(formRequest(form))).status, 400);
    form.delete("backupId");
    assert.equal((await restore(formRequest(form))).status, 400);
    form.delete("file");
    assert.equal((await restore(formRequest(form))).status, 400);
    assert.equal((await s.manager.list()).length, 1);
    assert.deepEqual(s.repo.getWorkspace().projects, []);
  } finally {
    await s.cleanup();
  }
});

test("API restaura copia del servidor y archivo adjunto con o sin respaldo previo", async () => {
  const s = await setup();
  try {
    const project = s.repo.execute({
      type: "project.create",
      name: "Original",
      icon: "🌱",
      color: "#059669",
      description: "",
    }).createdId!;
    const snapshot = s.repo.getWorkspace();
    const backup = await s.manager.create();
    const bytes = await s.manager.download(backup.id);
    s.repo.execute({ type: "project.delete", id: project });
    const form = new FormData();
    form.set("backupId", backup.id);
    form.set("confirmation", "RESTAURAR");
    form.set("backupBeforeRestore", "true");
    const response = await restore(formRequest(form));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).safetyBackup.kind, "before-restore");
    assert.deepEqual(s.repo.getWorkspace(), snapshot);
    s.repo.execute({ type: "project.delete", id: project });
    form.delete("backupId");
    form.set("file", new File([bytes], "backup.sqlite"));
    form.set("backupBeforeRestore", "false");
    const uploaded = await restore(formRequest(form));
    assert.equal(uploaded.status, 200);
    assert.deepEqual(await uploaded.json(), {});
    assert.deepEqual(s.repo.getWorkspace(), snapshot);
    assert.equal((await s.manager.list()).length, 2);
  } finally {
    await s.cleanup();
  }
});
