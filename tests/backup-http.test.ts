import { authenticatedRequest, authConfig } from "./helpers";
import { actor, createRepository, addUser } from "./helpers";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PostgresRepository } from "../src/server/postgres";
import { BackupManager } from "../src/server/backups";
import { GET as list, POST as create } from "../src/app/api/backups/route";
import {
  GET as download,
  DELETE as remove,
} from "../src/app/api/backups/[id]/route";
import { POST as restore } from "../src/app/api/backups/restore/route";
import { POST as upload } from "../src/app/api/backups/uploads/route";
import type { BackupStorage } from "../src/server/backup-storage";
const base = "http://localhost:5010";
async function setup() {
  Object.assign(process.env, authConfig);
  const dir = await mkdtemp(join(tmpdir(), "taskode-backup-http-"));
  const path = dir;
  const repo = await createRepository();
  const manager = new BackupManager(repo, path);
  Object.assign(globalThis, { taskodeRepository: repo, taskodeBackups: manager });
  return {
    repo,
    manager,
    async cleanup() {
      Reflect.deleteProperty(globalThis, "taskodeRepository");
      Reflect.deleteProperty(globalThis, "taskodeBackups");
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
async function formRequest(form: FormData) {
  return await authenticatedRequest(base + "/api/backups/restore", {
    method: "POST",
    body: form,
  });
}
test("API S3: solo el administrador obtiene enlaces; las cargas ambiguas no restauran datos", async () => {
  const s = await setup();
  let uploaded = false;
  const storage: BackupStorage = {
    list: async () => [],
    metadata: async (id) => ({ id, kind: "manual", size: 2, createdAt: new Date().toISOString() }),
    read: async () => Buffer.from("{}"),
    write: async () => {},
    delete: async () => {},
    createUpload: async () => { uploaded = true; return { id: "temporary-id", url: "https://private.example/upload" }; },
    downloadUrl: async () => "https://private.example/download",
  };
  Object.assign(globalThis, { taskodeBackups: new BackupManager(s.repo, tmpdir(), storage) });
  try {
    assert.equal((await upload(new Request(base + "/api/backups/uploads", { method: "POST" }))).status, 401);
    await addUser(s.repo, "member-upload");
    assert.equal((await upload(await authenticatedRequest(base + "/api/backups/uploads", { method: "POST" }, "member-upload"))).status, 403);
    assert.equal(uploaded, false);
    assert.equal((await upload(await authenticatedRequest(base + "/api/backups/uploads", { method: "POST", headers: { origin: "https://foreign.example" } }))).status, 403);
    const response = await upload(await authenticatedRequest(base + "/api/backups/uploads", { method: "POST" }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { id: "temporary-id", url: "https://private.example/upload" });
    const id = "taskode-manual-2026-10-16T10-20-30-123Z-11111111-1111-4111-8111-111111111111.taskode-backup.json";
    const context = { params: Promise.resolve({ id }) };
    const signed = await download(await authenticatedRequest(base + "/api/backups/" + id + "?url=1"), context);
    assert.deepEqual(await signed.json(), { url: "https://private.example/download" });
    assert.equal(signed.headers.get("cache-control"), "no-store");
    const redirect = await download(await authenticatedRequest(base + "/api/backups/" + id), context);
    assert.equal(redirect.status, 302);
    assert.equal(redirect.headers.get("location"), "https://private.example/download");
    const form = new FormData();
    form.set("confirmation", "RESTAURAR");
    form.set("backupBeforeRestore", "true");
    form.set("backupId", id);
    form.set("uploadId", "temporary-id");
    const snapshot = await s.repo.getWorkspace(actor);
    assert.equal((await restore(await formRequest(form))).status, 400);
    assert.deepEqual(await s.repo.getWorkspace(actor), snapshot);
  } finally { await s.cleanup(); }
});
test("API de respaldos: lista, genera, descarga y elimina con nombres seguros", async () => {
  const s = await setup();
  try {
    assert.deepEqual(
      await (await list(await authenticatedRequest(base))).json(),
      { backups: [] },
    );
    const response = await create(
      await authenticatedRequest(base + "/api/backups", { method: "POST" }),
    );
    assert.equal(response.status, 201);
    const { backup } = await response.json();
    const context = { params: Promise.resolve({ id: backup.id }) };
    const file = await download(await authenticatedRequest(base), context);
    assert.equal(file.status, 200);
    assert.equal(file.headers.get("cache-control"), "no-store");
    assert.match(
      file.headers.get("content-disposition")!,
      /attachment; filename="taskode-/,
    );
    assert.equal(
      JSON.parse(Buffer.from(await file.arrayBuffer()).toString()).format,
      "taskode-backup",
    );
    assert.equal(
      (await (await list(await authenticatedRequest(base))).json()).backups
        .length,
      1,
    );
    assert.equal(
      (
        await remove(
          await authenticatedRequest(base, { method: "DELETE" }),
          context,
        )
      ).status,
      204,
    );
    assert.equal(
      (await download(await authenticatedRequest(base), context)).status,
      404,
    );
    assert.equal(
      (
        await remove(await authenticatedRequest(base, { method: "DELETE" }), {
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
      (
        await create(
          await authenticatedRequest(base, {
            method: "POST",
            headers: foreign,
          }),
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await remove(
          await authenticatedRequest(base, {
            method: "DELETE",
            headers: foreign,
          }),
          { params: Promise.resolve({ id: "missing" }) },
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await restore(
          await authenticatedRequest(base, {
            method: "POST",
            headers: foreign,
          }),
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await restore(
          await authenticatedRequest(base, {
            method: "POST",
            body: "not multipart",
          }),
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await restore(
          await authenticatedRequest(base, {
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
    assert.equal((await restore(await formRequest(form))).status, 400);
    form.set("confirmation", "RESTAURAR");
    form.delete("backupBeforeRestore");
    assert.equal((await restore(await formRequest(form))).status, 400);
    form.set("backupBeforeRestore", "false");
    form.set("file", new File(["invalid"], "invalid.taskode-backup.json"));
    assert.equal((await restore(await formRequest(form))).status, 400);
    form.delete("backupId");
    assert.equal((await restore(await formRequest(form))).status, 400);
    form.delete("file");
    assert.equal((await restore(await formRequest(form))).status, 400);
    assert.equal((await s.manager.list()).length, 1);
    assert.deepEqual((await s.repo.getWorkspace(actor)).projects, []);
  } finally {
    await s.cleanup();
  }
});
test("API restaura copia del servidor y archivo adjunto con o sin respaldo previo", async () => {
  const s = await setup();
  try {
    const project = (
      await s.repo.execute(
        {
          type: "project.create",
          name: "Original",
          icon: "🌱",
          color: "#059669",
          description: "",
        },
        actor,
      )
    ).createdId!;
    const snapshot = await s.repo.getWorkspace(actor);
    const backup = await s.manager.create();
    const bytes = await s.manager.download(backup.id);
    await s.repo.execute({ type: "project.delete", id: project }, actor);
    const form = new FormData();
    form.set("backupId", backup.id);
    form.set("confirmation", "RESTAURAR");
    form.set("backupBeforeRestore", "true");
    const response = await restore(await formRequest(form));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).safetyBackup.kind, "before-restore");
    assert.deepEqual(await s.repo.getWorkspace(actor), snapshot);
    await s.repo.execute({ type: "project.delete", id: project }, actor);
    form.delete("backupId");
    form.set("file", new File([bytes], "backup.taskode-backup.json"));
    form.set("backupBeforeRestore", "false");
    const uploaded = await restore(await formRequest(form));
    assert.equal(uploaded.status, 200);
    assert.deepEqual(await uploaded.json(), {});
    assert.deepEqual(await s.repo.getWorkspace(actor), snapshot);
    assert.equal((await s.manager.list()).length, 2);
  } finally {
    await s.cleanup();
  }
});
