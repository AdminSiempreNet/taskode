import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { actor, addUser, createRepository } from "./helpers";
import { FileManager } from "../src/server/files";
import { LocalFileStorage } from "../src/server/file-storage";
import { files } from "../src/server/schema";
import { youtubeUrl } from "../src/lib/files";
import { validateApplicationBackup } from "../src/server/backup-data";
import { S3Client } from "@aws-sdk/client-s3";
import { S3FileStorage } from "../src/server/file-storage";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aPZ8AAAAASUVORK5CYII=",
  "base64",
);
test("archivos privados: publicación, pegado antes de crear, referencias, límite y acceso revocado", async () => {
  const repo = await createRepository();
  const directory = await mkdtemp(join(tmpdir(), "taskode-files-"));
  try {
    const owner = await addUser(repo, "owner"),
      other = await addUser(repo, "other");
    const projectId = (
      await repo.execute(
        {
          type: "project.create",
          name: "Archivos",
          description: "",
          color: "#059669",
          icon: "A",
        },
        owner,
      )
    ).createdId!;
    await repo.execute(
      { type: "project.member.add", projectId, userId: other.id },
      owner,
    );
    const w = await repo.getWorkspace(owner);
    const fields = {
      projectId,
      featureId: w.features[0].id,
      statusId: w.statuses[0].id,
      priority: "medium",
      dueDate: null,
      title: "Tarea",
      labels: [],
    };
    const storage = new LocalFileStorage(directory),
      manager = new FileManager(repo, storage);
    const upload = await manager.begin(owner, {
      projectId,
      name: "captura.png",
      size: png.length,
      purpose: "image",
    });
    await manager.put(
      owner,
      upload.id,
      new Request("http://localhost/upload", { method: "PUT", body: png }),
    );
    await manager.complete(owner, upload.id);
    assert.equal((await manager.content(owner, upload.id, false)).status, 200);
    await assert.rejects(manager.content(other, upload.id, false), {
      status: 404,
    });
    const description = `![Captura](/api/files/${upload.id}/content)`;
    const id = (
      await repo.execute({ type: "task.create", ...fields, description }, owner)
    ).createdId!;
    assert.equal(
      (await repo.getWorkspace(owner)).tasks[0].files![0].id,
      upload.id,
    );
    const backupPath = join(directory, "files-backup.json");
    await repo.exportBackup(backupPath);
    const backup = JSON.parse(await readFile(backupPath, "utf8"));
    validateApplicationBackup(backup);
    const forged = structuredClone(backup);
    forged.tables.files[0].name = "script.svg";
    forged.tables.files[0].mimeType = "image/svg+xml";
    assert.throws(() => validateApplicationBackup(forged));
    await assert.rejects(manager.content(other, upload.id, false), {
      status: 404,
    });
    await repo.execute(
      {
        type: "task.assignment.update",
        id,
        leaderId: owner.id,
        teamMemberIds: [other.id],
      },
      owner,
    );
    assert.equal((await manager.content(other, upload.id, false)).status, 200);
    await assert.rejects(manager.remove(other, upload.id), { status: 409 });
    await repo.execute(
      { type: "task.update", ...fields, id, description: "" },
      other,
    );
    await manager.remove(other, upload.id);
    assert.equal(await storage.exists(upload.id), false);
    await assert.rejects(
      manager.begin(owner, {
        projectId,
        name: "large.pdf",
        size: 10485761,
        purpose: "document",
      }),
      { status: 413 },
    );
    await assert.rejects(
      manager.begin(owner, {
        projectId,
        name: "script.svg",
        size: 10,
        purpose: "image",
      }),
    );
    const fake = await manager.begin(owner, {
      projectId,
      name: "fake.pdf",
      size: png.length,
      purpose: "document",
    });
    await manager.put(
      owner,
      fake.id,
      new Request("http://localhost/upload", { method: "PUT", body: png }),
    );
    await assert.rejects(manager.complete(owner, fake.id), /no coincide/);
    assert.equal(await storage.exists(fake.id), false);
    const pending = await manager.begin(owner, {
      projectId,
      name: "old.png",
      size: png.length,
      purpose: "image",
    });
    await repo.store.db
      .update(files)
      .set({ createdAt: new Date(Date.now() - 90000000).toISOString() })
      .where(eq(files.id, pending.id));
    await manager.cleanup();
    assert.equal(
      (await repo.store.db.select().from(files).where(eq(files.id, pending.id)))
        .length,
      0,
    );
    await assert.rejects(
      repo.execute(
        {
          type: "task.create",
          ...fields,
          description: "![x](data:image/png;base64,AAAA)",
        },
        owner,
      ),
      /almacenamiento/,
    );
  } finally {
    await repo.close();
    await rm(directory, { recursive: true, force: true });
  }
});
test("YouTube admite enlaces habituales y rechaza dominios parecidos o contenido arbitrario", () => {
  for (const url of [
    "https://youtu.be/dQw4w9WgXcQ",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtube.com/shorts/dQw4w9WgXcQ",
    "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
  ])
    assert.equal(
      youtubeUrl(url),
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    );
  for (const url of [
    "https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ",
    "javascript:alert(1)",
    "https://youtube.com/watch?v=bad",
  ])
    assert.equal(youtubeUrl(url), null);
});

test("S3 privado: valida bytes antes de publicar, no reutiliza el objeto temporal y firma descargas cortas", async () => {
  const repo = await createRepository();
  const client = new S3Client({
    region: "auto",
    endpoint: "https://example.r2.cloudflarestorage.com",
    credentials: { accessKeyId: "test", secretAccessKey: "test-secret" },
  });
  const objects = new Map<string, Buffer>();
  let replaceStaging = false;
  client.send = (async (command: {
    constructor: { name: string };
    input: Record<string, unknown>;
  }) => {
    const key = String(command.input.Key),
      bytes = objects.get(key);
    switch (command.constructor.name) {
      case "HeadObjectCommand":
        if (!bytes) throw { $metadata: { httpStatusCode: 404 } };
        return { ContentLength: bytes.length, ETag: "test-etag" };
      case "GetObjectCommand": {
        assert.ok(bytes);
        if (replaceStaging && key.includes("/pending/"))
          objects.set(key, Buffer.from("Changed after validation"));
        return {
          Body: {
            async *[Symbol.asyncIterator]() {
              yield bytes;
            },
            transformToByteArray: async () => bytes,
          },
        };
      }
      case "PutObjectCommand":
        assert.equal(command.input.IfNoneMatch, "*");
        objects.set(key, Buffer.from(command.input.Body as Uint8Array));
        return {};
      case "DeleteObjectCommand":
        objects.delete(key);
        return {};
      default:
        throw new Error(command.constructor.name);
    }
  }) as typeof client.send;
  try {
    const projectId = (
      await repo.execute(
        {
          type: "project.create",
          name: "S3",
          description: "",
          icon: "S",
          color: "#059669",
        },
        actor,
      )
    ).createdId!;
    const storage = new S3FileStorage(client, "private-bucket", "qa/");
    const manager = new FileManager(repo, storage);
    const upload = await manager.begin(actor, {
      projectId,
      name: "image.png",
      size: png.length,
      purpose: "image",
    });
    assert.match(upload.url!, /qa\/attachments\/pending\//);
    assert.equal(new URL(upload.url!).searchParams.get("X-Amz-Expires"), "300");
    objects.set(`qa/attachments/pending/${upload.id}`, png);
    replaceStaging = true;
    await manager.complete(actor, upload.id);
    assert.deepEqual(objects.get(`qa/attachments/${upload.id}`), png);
    assert.equal(objects.has(`qa/attachments/pending/${upload.id}`), false);
    const download = await manager.content(actor, upload.id, false);
    assert.equal(download.status, 302);
    assert.equal(
      new URL(download.headers.get("location")!).searchParams.get(
        "X-Amz-Expires",
      ),
      "60",
    );
  } finally {
    client.destroy();
    await repo.close();
  }
});
