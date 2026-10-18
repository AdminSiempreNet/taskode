import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { eq } from "drizzle-orm";
import { actor, addUser, createRepository } from "./helpers";
import { FileManager } from "../src/server/files";
import { LocalFileStorage } from "../src/server/file-storage";
import { comments, files } from "../src/server/schema";
import { flushCommentEvents } from "../src/server/realtime";
import { commentsChannel } from "../src/server/realtime-config";
import { validateApplicationBackup } from "../src/server/backup-data";
import { commandSchema } from "../src/lib/validation";
import { entityPath, safeReturnTo } from "../src/lib/routes";
import type { EntityRef, EntityKind } from "../src/lib/types";
import { stripEntityColumns } from "./entity-fixtures";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aPZ8AAAAASUVORK5CYII=",
  "base64",
);
async function fixture() {
  const repo = await createRepository();
  const owner = await addUser(repo, "owner"),
    moduleOwner = await addUser(repo, "module-owner"),
    featureOwner = await addUser(repo, "feature-owner"),
    participant = await addUser(repo, "participant"),
    outside = await addUser(repo, "outside");
  const projectId = (
    await repo.execute(
      {
        type: "project.create",
        name: "Proyecto",
        description: "Descripción original",
        color: "#059669",
        icon: "P",
      },
      owner,
    )
  ).createdId!;
  for (const person of [moduleOwner, featureOwner, participant])
    await repo.execute(
      { type: "project.team.add", projectId, userId: person.id },
      owner,
    );
  const moduleId = (
    await repo.execute(
      {
        type: "module.create",
        projectId,
        name: "Módulo",
        description: "Descripción original",
      },
      moduleOwner,
    )
  ).createdId!;
  const featureId = (
    await repo.execute(
      {
        type: "feature.create",
        projectId,
        moduleId,
        name: "Feature",
        description: "Descripción original",
      },
      featureOwner,
    )
  ).createdId!;
  const scopes: EntityRef[] = [
    { kind: "project", id: projectId, projectId },
    { kind: "module", id: moduleId, projectId },
    { kind: "feature", id: featureId, projectId },
  ];
  return {
    repo,
    owner,
    moduleOwner,
    featureOwner,
    participant,
    outside,
    projectId,
    moduleId,
    featureId,
    scopes,
  };
}

test("detalles: lectura por proyecto, gestión por propietarios superiores y renombrado independiente", async () => {
  const f = await fixture();
  try {
    for (const scope of f.scopes) {
      const view = await f.repo.entityDetail(
        f.participant,
        scope.kind,
        scope.id,
      );
      assert.equal(view.permissions.canEdit, false);
      assert.equal(view.permissions.canComment, true);
      assert.equal(view.permissions.canManageFiles, false);
      for (const user of [actor, f.owner])
        assert.equal(
          (await f.repo.entityDetail(user, scope.kind, scope.id)).permissions
            .canEdit,
          true,
        );
      await assert.rejects(
        f.repo.entityDetail(f.outside, scope.kind, scope.id),
        { status: 404 },
      );
      await assert.rejects(
        f.repo.entityDetail(f.owner, scope.kind, scope.id, "wrong-project"),
        { status: 404 },
      );
      const rename = commandSchema.parse({
        type: `${scope.kind}.rename`,
        id: scope.id,
        name: "Renombrado",
      });
      await assert.rejects(f.repo.execute(rename, f.participant), {
        status: 403,
      });
      await f.repo.execute(rename, f.owner);
      assert.equal(
        (await f.repo.entityDetail(f.owner, scope.kind, scope.id)).entity
          .description,
        "Descripción original",
      );
    }
    assert.equal(
      (await f.repo.entityDetail(f.moduleOwner, "feature", f.featureId))
        .permissions.canEdit,
      true,
    );
    assert.equal(
      (await f.repo.entityDetail(f.featureOwner, "module", f.moduleId))
        .permissions.canEdit,
      false,
    );
    assert.equal(
      commandSchema.safeParse({
        type: "module.rename",
        id: f.moduleId,
        name: "x".repeat(161),
      }).success,
      false,
    );
  } finally {
    await f.repo.close();
  }
});

test("comentarios jerárquicos: aislamiento, autoría, idempotencia, outbox y permisos revocados", async () => {
  const f = await fixture();
  try {
    for (const scope of f.scopes) {
      const requestId = randomUUID();
      const command = commandSchema.parse({
        type: "comment.create",
        scope,
        content: scope.kind,
        requestId,
      });
      await f.repo.executeEntityComment(
        f.participant,
        scope.kind,
        scope.id,
        command,
      );
      await f.repo.executeEntityComment(
        f.participant,
        scope.kind,
        scope.id,
        command,
      );
      const snapshot = await f.repo.entityComments(
        f.owner,
        scope.kind,
        scope.id,
      );
      assert.equal(snapshot.comments.length, 1);
      assert.equal(snapshot.comments[0].taskId, null);
      assert.deepEqual(snapshot.comments[0].scope, scope);
      await assert.rejects(
        f.repo.execute(
          { type: "comment.update", id: requestId, content: "No soy autor" },
          f.owner,
        ),
        { status: 403 },
      );
      await f.repo.execute(
        { type: "comment.update", id: requestId, content: "Editado" },
        f.participant,
      );
      await assert.rejects(
        f.repo.executeEntityComment(f.participant, "feature", f.featureId, {
          type: "comment.create",
          scope: { ...scope, kind: "project", id: f.projectId },
          content: "Ajeno",
        }),
        { status: 404 },
      );
      const another = f.scopes.find((s) => s.kind !== scope.kind)!;
      await assert.rejects(
        f.repo.execute(
          {
            type: "comment.create",
            scope: another,
            requestId,
            content: "Duplicado ajeno",
          },
          f.participant,
        ),
        { status: 409 },
      );
    }
    const deliveries: EntityKind[] = [];
    assert.deepEqual(
      await flushCommentEvents(f.repo, async (event, recipients) => {
        deliveries.push(event.scopeType!);
        assert.ok(recipients.includes(f.participant.id));
        assert.ok(!recipients.includes(f.outside.id));
      }),
      { sent: 3, failed: 0 },
    );
    assert.deepEqual(deliveries.sort(), ["feature", "module", "project"]);
    assert.notEqual(
      commentsChannel("test", f.featureId, f.participant.id, "feature"),
      commentsChannel("test", f.featureId, f.participant.id, "task"),
    );
    const note = (await f.repo.entityComments(f.owner, "feature", f.featureId))
      .comments[0];
    await f.repo.execute(
      { type: "comment.delete", id: String(note.id) },
      f.moduleOwner,
    );
    await f.repo.execute(
      {
        type: "project.team.remove",
        projectId: f.projectId,
        userId: f.participant.id,
      },
      f.owner,
    );
    await assert.rejects(
      f.repo.entityComments(f.participant, "project", f.projectId),
      { status: 404 },
    );
    await flushCommentEvents(f.repo, async (_event, recipients) =>
      assert.ok(!recipients.includes(f.participant.id)),
    );
    assert.equal(
      commandSchema.safeParse({
        type: "comment.create",
        content: "Sin destino",
      }).success,
      false,
    );
  } finally {
    await f.repo.close();
  }
});

test("archivos: documentos por entidad, imágenes de participantes, referencias y limpieza de temporales", async () => {
  const f = await fixture();
  const directory = await mkdtemp(join(tmpdir(), "taskode-entities-"));
  const storage = new LocalFileStorage(directory),
    manager = new FileManager(f.repo, storage);
  const upload = async (
    who: { id: string },
    scope: EntityRef | undefined,
    purpose: "file" | "image",
  ) => {
    const result = await manager.begin(who, {
      projectId: f.projectId,
      scope,
      name: "imagen.png",
      size: png.length,
      purpose,
    });
    await manager.put(
      who,
      result.id,
      new Request("http://localhost/upload", { method: "PUT", body: png }),
    );
    await manager.complete(
      who,
      result.id,
      purpose === "file" ? scope : undefined,
    );
    return result.id;
  };
  try {
    for (const scope of f.scopes) {
      await assert.rejects(
        manager.begin(f.participant, {
          projectId: f.projectId,
          scope,
          name: "imagen.png",
          size: png.length,
          purpose: "file",
        }),
        { status: 403 },
      );
      const id = await upload(f.owner, scope, "file");
      assert.equal(
        (await manager.content(f.participant, id, false)).status,
        200,
      );
      await assert.rejects(manager.remove(f.participant, id), { status: 403 });
      await f.repo.store.db
        .update(files)
        .set({ createdAt: "2020-01-01T00:00:00.000Z" })
        .where(eq(files.id, id));
      await manager.cleanup();
      assert.equal(
        (await f.repo.entityDetail(f.participant, scope.kind, scope.id))
          .files[0].id,
        id,
      );
      assert.equal(await storage.exists(id), true);
    }
    const backupPath = join(directory, "documents-v5.json");
    await f.repo.exportBackup(backupPath);
    const backup = validateApplicationBackup(
      JSON.parse(await readFile(backupPath, "utf8")),
    );
    assert.deepEqual(backup.tables.files.map((file) => file.scopeType).sort(), [
      "feature",
      "module",
      "project",
    ]);
    await f.repo.restoreBackup(backupPath);
    for (const scope of f.scopes)
      assert.equal(
        (await f.repo.entityDetail(f.participant, scope.kind, scope.id)).files
          .length,
        1,
      );
    const scope = f.scopes[2];
    const image = await upload(f.participant, scope, "image");
    const content = `![Imagen](/api/files/${image}/content)`;
    const note = (
      await f.repo.execute(
        { type: "comment.create", scope, content },
        f.participant,
      )
    ).createdId!;
    assert.equal((await manager.content(f.owner, image, false)).status, 200);
    await assert.rejects(manager.remove(f.owner, image), { status: 409 });
    await assert.rejects(
      f.repo.execute(
        { type: "comment.create", scope: f.scopes[0], content },
        f.participant,
      ),
      { status: 403 },
    );
    const temporaryDocument = await upload(
      f.participant,
      undefined,
      "file",
    );
    await assert.rejects(
      f.repo.execute(
        {
          type: "comment.create",
          scope,
          content: `[Documento](/api/files/${temporaryDocument}/content)`,
        },
        f.participant,
      ),
      { status: 403 },
    );
    await f.repo.execute({ type: "comment.delete", id: note }, f.participant);
    await manager.remove(f.owner, image);
    await f.repo.execute({ type: "module.delete", id: f.moduleId }, f.owner);
    assert.equal(
      (await f.repo.getWorkspace(f.owner)).features.find(
        (feature) => feature.id === f.featureId,
      )?.moduleId,
      null,
    );
    assert.equal(
      (await f.repo.entityDetail(f.owner, "feature", f.featureId)).files.length,
      1,
    );
    await f.repo.execute({ type: "feature.delete", id: f.featureId }, f.owner);
    await assert.rejects(manager.content(f.participant, image, false), {
      status: 404,
    });
  } finally {
    await f.repo.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("respaldo actual conserva los niveles y v4 normaliza comentarios y archivos históricos", async () => {
  const f = await fixture();
  const directory = await mkdtemp(join(tmpdir(), "taskode-entity-backup-"));
  try {
    const workspace = await f.repo.getWorkspace(f.owner);
    const taskId = (
      await f.repo.execute(
        {
          type: "task.create",
          projectId: f.projectId,
          featureId: f.featureId,
          title: "Tarea histórica",
          description: "",
          statusId: workspace.statuses[0].id,
          priority: "medium",
          dueDate: null,
          labels: [],
        },
        f.owner,
      )
    ).createdId!;
    await f.repo.execute(
      { type: "comment.create", taskId, content: "Comentario histórico" },
      f.owner,
    );
    for (const scope of f.scopes)
      await f.repo.execute(
        { type: "comment.create", scope, content: scope.kind },
        f.participant,
      );
    const path = join(directory, "v5.json");
    await f.repo.exportBackup(path);
    const backup = JSON.parse(await readFile(path, "utf8"));
    assert.equal(backup.version, 9);
    validateApplicationBackup(backup);
    for (const mutation of [
      (copy: typeof backup) => {
        copy.tables.comments[0].scopeType = "unknown";
      },
      (copy: typeof backup) => {
        copy.tables.comments[0].taskId = "unknown";
      },
      (copy: typeof backup) => {
        copy.tables.comments[0].projectId = "wrong";
      },
    ]) {
      const copy = structuredClone(backup);
      mutation(copy);
      assert.throws(() => validateApplicationBackup(copy));
    }
    await f.repo.restoreBackup(path);
    for (const scope of f.scopes)
      assert.equal(
        (await f.repo.entityComments(f.owner, scope.kind, scope.id)).comments
          .length,
        1,
      );
    const legacy = structuredClone(backup);
    legacy.version = 4;
    legacy.tables.comments = legacy.tables.comments.filter(
      (comment: { taskId: string | null }) => comment.taskId !== null,
    );
    stripEntityColumns(legacy.tables);
    assert.equal(validateApplicationBackup(legacy).version, 9);
    const legacyPath = join(directory, "v4.json");
    await writeFile(legacyPath, JSON.stringify(legacy));
    await f.repo.restoreBackup(legacyPath);
    assert.equal((await f.repo.store.db.select().from(comments)).length, 1);
    assert.equal(
      (await f.repo.taskComments(f.owner, taskId)).comments[0].content,
      "Comentario histórico",
    );
  } finally {
    await f.repo.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("rutas de detalle mantienen contexto y rechazan retornos externos o de otro proyecto", () => {
  const path = entityPath(
    "p",
    "feature",
    "f",
    "list",
    "tasks",
    "/projects/p/details?tab=modules",
  );
  assert.equal(
    new URL(path, "http://localhost").searchParams.get("returnTo"),
    "/projects/p/details?tab=modules",
  );
  for (const value of [
    "https://evil.test",
    "//evil.test",
    "/projects/other/details",
    "/projects/p/../other",
    "/projects/pp/details",
    "/api/workspace",
    "/\\evil.test",
  ])
    assert.equal(safeReturnTo("p", value), null);
  assert.equal(
    safeReturnTo("p", "/projects/p/modules/general?tab=features"),
    "/projects/p/modules/general?tab=features",
  );
});
