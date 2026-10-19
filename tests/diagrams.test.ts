import { stripTicketTables } from "./entity-fixtures";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { actor, addUser, createRepository } from "./helpers";
import { DiagramsService } from "../src/server/diagrams";
import { diagrams, moduleTeamMembers } from "../src/server/schema";
import {
  emptyDiagramScene,
  MAX_DIAGRAM_BYTES,
  sceneFingerprint,
} from "../src/lib/diagrams";
import { validateApplicationBackup } from "../src/server/backup-data";

const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aPZ8AAAAASUVORK5CYII=";
const payload = (title = "Arquitectura") => ({
  title,
  description: "Flujo de acceso",
  scene: emptyDiagramScene(),
});
test("comparación del lienzo ignora el orden de claves que cambia JSONB", () => {
  const scene = emptyDiagramScene();
  scene.elements.push({
    id: "rect",
    type: "rectangle",
    x: 10,
    y: 20,
    width: 30,
    height: 40,
  });
  const reordered = JSON.parse(
    JSON.stringify(scene, (_key, value) =>
      value && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).reverse())
        : value,
    ),
  );
  assert.equal(sceneFingerprint(scene), sceneFingerprint(reordered));
  reordered.elements[0].x = 11;
  assert.notEqual(sceneFingerprint(scene), sceneFingerprint(reordered));
});
async function fixture() {
  const repo = await createRepository(),
    service = new DiagramsService(repo);
  const owner = await addUser(repo, "diagram-owner"),
    member = await addUser(repo, "diagram-member"),
    outside = await addUser(repo, "diagram-outside");
  const projectId = (
    await repo.execute(
      {
        type: "project.create",
        name: "Diagramas",
        description: "",
        color: "#059669",
        icon: "D",
      },
      owner,
    )
  ).createdId!;
  await repo.execute(
    { type: "project.team.add", projectId, userId: member.id },
    owner,
  );
  const moduleId = (
    await repo.execute(
      { type: "module.create", projectId, name: "Módulo", description: "" },
      owner,
    )
  ).createdId!;
  const featureId = (
    await repo.execute(
      {
        type: "feature.create",
        projectId,
        moduleId,
        name: "Feature",
        description: "",
      },
      owner,
    )
  ).createdId!;
  const workspace = await repo.getWorkspace(owner);
  const taskId = (
    await repo.execute(
      {
        type: "task.create",
        projectId,
        featureId,
        statusId: workspace.statuses[0].id,
        title: "Privada",
        description: "",
        priority: "medium",
        labels: [],
        dueDate: null,
        leaderId: owner.id,
        teamMemberIds: [],
      },
      owner,
    )
  ).createdId!;
  return {
    repo,
    service,
    owner,
    member,
    outside,
    projectId,
    moduleId,
    featureId,
    taskId,
  };
}
test("diagramas: cuatro ámbitos, permisos actuales y aislamiento de tareas privadas", async () => {
  const f = await fixture();
  try {
    for (const [kind, id] of [
      ["project", f.projectId],
      ["module", f.moduleId],
      ["feature", f.featureId],
      ["task", f.taskId],
    ] as const) {
      const doc = await f.service.create(f.owner, kind, id, payload());
      assert.equal(
        (await f.service.list(f.owner, kind, id)).diagrams.length,
        1,
      );
      assert.equal(doc.scope.kind, kind);
      assert.equal(
        (await f.service.get(actor, doc.id)).permissions.canEdit,
        true,
      );
      await assert.rejects(f.service.get(f.outside, doc.id), { status: 404 });
      await assert.rejects(f.service.create(f.member, kind, id, payload()), {
        status: kind === "task" ? 404 : 403,
      });
      if (kind !== "task")
        assert.equal(
          (await f.service.get(f.member, doc.id)).permissions.canEdit,
          false,
        );
      else
        await assert.rejects(f.service.get(f.member, doc.id), { status: 404 });
    }
    const doc = await f.service.create(
      f.owner,
      "module",
      f.moduleId,
      payload("Editable"),
    );
    await f.repo.store.db
      .insert(moduleTeamMembers)
      .values({ moduleId: f.moduleId, userId: f.member.id });
    const updated = await f.service.save(
      f.member,
      doc.id,
      1,
      payload("Modificado"),
    );
    assert.equal(updated.revision, 2);
    await assert.rejects(f.service.share(f.member, doc.id, true), {
      status: 403,
    });
    assert.equal("publicPath" in updated, false);
    await f.repo.store.db
      .delete(moduleTeamMembers)
      .where(eq(moduleTeamMembers.moduleId, f.moduleId));
    await assert.rejects(f.service.save(f.member, doc.id, 2, payload()), {
      status: 403,
    });
  } finally {
    await f.repo.close();
  }
});
test("diagramas: imágenes en PostgreSQL, conflicto atómico, validación y límite", async () => {
  const f = await fixture();
  try {
    const value = payload();
    value.scene.elements.push({
      id: "image",
      type: "image",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      fileId: "png",
    });
    value.scene.files.png = {
      id: "png",
      mimeType: "image/png",
      dataURL: png,
      created: 1,
    };
    const doc = await f.service.create(f.owner, "task", f.taskId, value);
    assert.equal(
      (await f.service.get(f.owner, doc.id)).scene.files.png.dataURL,
      png,
    );
    const saves = await Promise.allSettled([
      f.service.save(f.owner, doc.id, 1, { ...value, title: "Primero" }),
      f.service.save(f.owner, doc.id, 1, { ...value, title: "Segundo" }),
    ]);
    assert.equal(saves.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(
      (saves.find((r) => r.status === "rejected") as PromiseRejectedResult)
        .reason.status,
      409,
    );
    const huge = { ...value, description: "a".repeat(MAX_DIAGRAM_BYTES) };
    await assert.rejects(f.service.save(f.owner, doc.id, 2, huge), {
      status: 413,
    });
    assert.equal((await f.service.get(f.owner, doc.id)).revision, 2);
    await assert.rejects(
      f.service.create(f.owner, "task", f.taskId, {
        ...value,
        scene: { ...value.scene, files: {} },
      }),
      { status: 400 },
    );
    await assert.rejects(
      f.service.create(f.owner, "task", f.taskId, { ...value, title: " " }),
      { status: 400 },
    );
    await assert.rejects(
      f.service.create(f.owner, "task", f.taskId, {
        ...value,
        scene: {
          ...value.scene,
          elements: [{ ...value.scene.elements[0], type: "embeddable" }],
        },
      }),
      { status: 400 },
    );
    assert.equal(
      "scene" in (await f.service.list(f.owner, "task", f.taskId)).diagrams[0],
      false,
    );
  } finally {
    await f.repo.close();
  }
});
test("diagramas: enlace anónimo, sin metadatos privados, última versión y revocación", async () => {
  const f = await fixture();
  try {
    const doc = await f.service.create(
      f.owner,
      "project",
      f.projectId,
      payload(),
    );
    assert.equal(doc.isPublic, false);
    const shared = await f.service.share(f.owner, doc.id, true),
      token = shared.publicPath!.split("/").at(-1)!;
    assert.deepEqual(
      Object.keys(await f.service.publicDocument(token)).sort(),
      ["description", "scene", "title"],
    );
    await f.service.save(f.owner, doc.id, 1, payload("Versión nueva"));
    assert.equal(
      (await f.service.publicDocument(token)).title,
      "Versión nueva",
    );
    await f.service.share(f.owner, doc.id, false);
    await assert.rejects(f.service.publicDocument(token), { status: 404 });
    const again = await f.service.share(f.owner, doc.id, true);
    assert.notEqual(again.publicPath, shared.publicPath);
    await f.service.remove(f.owner, doc.id);
    await assert.rejects(
      f.service.publicDocument(again.publicPath!.split("/").at(-1)!),
      { status: 404 },
    );
  } finally {
    await f.repo.close();
  }
});
test("diagramas: respaldo v8 portable, v7 compatible y restauración privada", async () => {
  const f = await fixture(),
    directory = await mkdtemp(join(tmpdir(), "taskode-diagrams-"));
  try {
    const value = payload();
    value.scene.elements.push({
      id: "image",
      type: "image",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      fileId: "png",
    });
    value.scene.files.png = {
      id: "png",
      mimeType: "image/png",
      dataURL: png,
      created: 1,
    };
    const doc = await f.service.create(f.owner, "feature", f.featureId, value);
    const shared = await f.service.share(f.owner, doc.id, true);
    const path = join(directory, "backup.json");
    await f.repo.exportBackup(path);
    const backup = JSON.parse(await readFile(path, "utf8"));
    assert.equal(backup.version, 13);
    assert.equal(backup.tables.diagrams[0].publicToken, null);
    assert.equal(backup.tables.diagrams[0].scene.files.png.dataURL, png);
    const corrupted = structuredClone(backup);
    corrupted.tables.diagrams[0].projectId = "missing";
    assert.throws(() => validateApplicationBackup(corrupted));
    await f.repo.restoreBackup(path);
    assert.equal((await f.service.get(f.owner, doc.id)).isPublic, false);
    await assert.rejects(
      f.service.publicDocument(shared.publicPath!.split("/").at(-1)!),
      { status: 404 },
    );
    const legacy = structuredClone(backup);
    stripTicketTables(legacy.tables);
    legacy.version = 7;
    delete legacy.tables.diagrams;
    delete legacy.tables.documents;
    assert.deepEqual(validateApplicationBackup(legacy).tables.diagrams, []);
    await f.repo.execute({ type: "module.delete", id: f.moduleId }, f.owner);
    assert.equal((await f.service.get(f.owner, doc.id)).scope.kind, "feature");
    await f.repo.execute({ type: "feature.delete", id: f.featureId }, f.owner);
    assert.equal((await f.repo.store.db.select().from(diagrams)).length, 0);
  } finally {
    await f.repo.close();
    await rm(directory, { recursive: true, force: true });
  }
});
