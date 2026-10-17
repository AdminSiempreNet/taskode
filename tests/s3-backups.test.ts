import assert from "node:assert/strict";
import { test } from "node:test";
import { tmpdir } from "node:os";
import {
  S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand,
  ListObjectsV2Command, DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { S3BackupStorage, s3BackupConfig } from "../src/server/s3-backup-storage";
import { BackupManager } from "../src/server/backups";
import { MAX_BACKUP_BYTES, RESTORE_CONFIRMATION } from "../src/lib/backups";
import { actor, createRepository } from "./helpers";

function fixture() {
  const objects = new Map<string, Buffer<ArrayBuffer>>();
  let failWrite = false;
  const send = async (command: unknown) => {
    if (command instanceof PutObjectCommand) {
      if (failWrite) throw new Error("S3 unavailable");
      objects.set(command.input.Key!, Buffer.from(command.input.Body as Uint8Array));
      return {};
    }
    if (command instanceof DeleteObjectCommand) {
      objects.delete(command.input.Key!);
      return {};
    }
    if (command instanceof ListObjectsV2Command) {
      const entries = [...objects.entries()].filter(([key]) => key.startsWith(command.input.Prefix!));
      const offset = Number(command.input.ContinuationToken || 0);
      return {
        Contents: entries.slice(offset, offset + 1).map(([Key, bytes]) => ({ Key, Size: bytes.length })),
        IsTruncated: offset + 1 < entries.length,
        NextContinuationToken: String(offset + 1),
      };
    }
    if (command instanceof HeadObjectCommand || command instanceof GetObjectCommand) {
      const bytes = objects.get(command.input.Key!);
      if (!bytes) throw Object.assign(new Error("not found"), { $metadata: { httpStatusCode: 404 } });
      return { ContentLength: bytes.length, Body: { transformToByteArray: async () => bytes } };
    }
    throw new Error("Unsupported command");
  };
  const client = { send } as unknown as S3Client;
  return { storage: new S3BackupStorage(client, "private-bucket", "tareas/test/"), objects, fail: () => { failWrite = true; } };
}

test("S3: paginación, aislamiento por prefijo, metadatos, lectura y borrado", async () => {
  const { storage, objects } = fixture();
  const ids = [
    "brote-before-restore-2026-10-15T10-20-30-123Z-33333333-3333-4333-8333-333333333333.brote-backup.json",
    "taskode-manual-2026-10-16T10-20-30-123Z-11111111-1111-4111-8111-111111111111.taskode-backup.json",
    "taskode-before-restore-2026-10-16T11-20-30-123Z-22222222-2222-4222-8222-222222222222.taskode-backup.json",
  ];
  for (const id of ids) await storage.write({ id, size: 2, kind: "manual", createdAt: "" }, Buffer.from("{}"));
  objects.set("tareas/test/uploads/temporary.json", Buffer.from("{}"));
  objects.set("tareas/other/backups/hidden.json", Buffer.from("{}"));
  objects.set("tareas/test/backups/not-a-backup.json", Buffer.from("{}"));
  const files = await storage.list();
  assert.deepEqual(files.map((file) => file.id), [...ids].reverse());
  assert.equal(files[0].kind, "before-restore");
  assert.equal(files[0].createdAt, "2026-10-16T11:20:30.123Z");
  assert.deepEqual(await storage.metadata(ids[0]), files[2]);
  assert.equal((await storage.read(ids[0])).toString(), "{}");
  assert.equal((await storage.metadata(ids[0])).kind, "before-restore");
  await storage.delete(ids[0]);
  await assert.rejects(storage.read(ids[0]), /no existe/);
  await assert.rejects(storage.metadata("../private"), /no existe/);
  await assert.rejects(storage.readUpload("../backups/private"), /no es válida/);
});

test("S3: rechaza cargas excesivas antes de descargar el contenido", async () => {
  let consumed = false;
  const client = { send: async () => ({ ContentLength: MAX_BACKUP_BYTES + 1, Body: { transformToByteArray: async () => { consumed = true; return Buffer.from("{}"); } } }) } as unknown as S3Client;
  const storage = new S3BackupStorage(client, "bucket", "tareas/test/");
  await assert.rejects(storage.readUpload("11111111-1111-4111-8111-111111111111"), /100 MB/);
  assert.equal(consumed, false);
});

test("R2 y B2: enlaces firmados con el endpoint, región, prefijo y caducidad configurados", async () => {
  for (const [endpoint, region] of [["https://example.r2.cloudflarestorage.com", "auto"], ["https://s3.us-west-004.backblazeb2.com", "us-west-004"]]) {
    const config = s3BackupConfig({ S3_ENDPOINT: endpoint, S3_REGION: region, S3_BUCKET: "private-bucket", S3_ACCESS_KEY_ID: "test-id", S3_SECRET_ACCESS_KEY: "test-secret", S3_PREFIX: "tareas/test/" });
    const client = new S3Client(config.client);
    try {
      const storage = new S3BackupStorage(client, config.bucket, config.prefix);
      const upload = await storage.createUpload();
      const url = new URL(upload.url);
      assert.ok(url.hostname.endsWith(new URL(endpoint).hostname));
      assert.ok(url.pathname.includes(`/tareas/test/uploads/${upload.id}.json`));
      assert.equal(url.searchParams.get("X-Amz-Expires"), "300");
      assert.ok(url.searchParams.get("X-Amz-Credential")?.includes(`/${region}/s3/aws4_request`));
      const id = "taskode-manual-2026-10-16T10-20-30-123Z-11111111-1111-4111-8111-111111111111.taskode-backup.json";
      assert.ok((await storage.downloadUrl(id)).includes("response-content-disposition="));
    } finally { client.destroy(); }
  }
});

test("S3: un gestor nuevo recupera las copias y restaura cargas sin perder la copia previa", async () => {
  const repo = await createRepository();
  const { storage, objects, fail } = fixture();
  try {
    const manager = new BackupManager(repo, tmpdir(), storage);
    const snapshot = await repo.getWorkspace(actor);
    const file = await manager.create();
    const bytes = await manager.download(file.id);
    const second = new BackupManager(repo, tmpdir(), storage);
    assert.deepEqual(await second.list(), [file]);
    assert.deepEqual(await second.download(file.id), bytes);
    const id = "11111111-1111-4111-8111-111111111111";
    objects.set(`tareas/test/uploads/${id}.json`, bytes);
    const result = await second.restore({ uploadId: id }, RESTORE_CONFIRMATION, true);
    assert.ok(result.safetyBackup);
    assert.equal(objects.has(`tareas/test/uploads/${id}.json`), false);
    assert.deepEqual(await repo.getWorkspace(actor), snapshot);
    assert.equal((await manager.list()).length, 2);
    fail();
    await assert.rejects(second.restore({ backupId: file.id }, RESTORE_CONFIRMATION, true), /S3 unavailable/);
    assert.deepEqual(await repo.getWorkspace(actor), snapshot);
    await manager.delete(file.id);
    await assert.rejects(second.download(file.id), /no existe/);
  } finally { await repo.close(); }
});
