import { test } from "node:test";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MarkdownManager } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { getSchema } from "@tiptap/core";
import { createMarkdownParser } from "../src/lib/markdown-parser";
import { DescriptionImage } from "../src/components/description-image";
import { MarkdownYoutube } from "../src/components/media-extensions";
import { actor, addUser, createRepository } from "./helpers";
import { DocumentsService } from "../src/server/documents";
import { DiagramsService } from "../src/server/diagrams";
import { FileManager } from "../src/server/files";
import { LocalFileStorage } from "../src/server/file-storage";
import { emptyDiagramScene } from "../src/lib/diagrams";
import {
  diagramReferencePath,
  parseDiagramReference,
} from "../src/lib/documents";
import { DiagramReference } from "../src/components/diagram-reference";
import { validateApplicationBackup } from "../src/server/backup-data";
import type { EntityKind } from "../src/lib/types";

test("migración de documentos conserva los adjuntos y sus claves de almacenamiento", async () => {
  const repo = await createRepository();
  try {
    const projectId = (
      await repo.execute(
        {
          type: "project.create",
          name: "Migración",
          description: "",
          icon: "M",
          color: "#059669",
        },
        actor,
      )
    ).createdId!;
    const id = randomUUID();
    // Recreate the previous shape only inside this disposable test schema.
    assert.match(repo.store.schemaName, /^taskode_test_[a-f0-9]{32}$/);
    await repo.store.pool.query(
      "drop table documents; alter table files alter column purpose set default 'document'",
    );
    await repo.store.pool.query(
      'insert into files (id, "projectId", "scopeType", "uploadedBy", name, "mimeType", size, "storageKey", status, "createdAt") values ($1, $2, \'project\', $3, \'manual.pdf\', \'application/pdf\', 123, $1, \'ready\', $4)',
      [id, projectId, actor.id, new Date().toISOString()],
    );
    await repo.store.pool.query(
      await readFile("drizzle/postgresql/0010_documents.sql", "utf8"),
    );
    const result = await repo.store.pool.query(
      'select id, "storageKey", purpose, status from files where id = $1',
      [id],
    );
    assert.deepEqual(result.rows[0], {
      id,
      storageKey: id,
      purpose: "file",
      status: "ready",
    });
    assert.equal(
      (await new DocumentsService(repo).list(actor, "project", projectId))
        .documents.length,
      0,
    );
  } finally {
    await repo.close();
  }
});

const payload = (title = "Guía") => ({
  title,
  description: "Contexto",
  content: "## Objetivo\n\nTexto **importante**.",
});
async function fixture() {
  const repo = await createRepository(),
    docs = new DocumentsService(repo),
    draw = new DiagramsService(repo);
  const owner = await addUser(repo, "docs-owner"),
    reader = await addUser(repo, "docs-reader"),
    outsider = await addUser(repo, "docs-outsider");
  const projectId = (
    await repo.execute(
      {
        type: "project.create",
        name: "Documentación",
        description: "",
        color: "#059669",
        icon: "D",
      },
      owner,
    )
  ).createdId!;
  await repo.execute(
    { type: "project.team.add", projectId, userId: reader.id },
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
  const taskId = (
    await repo.execute(
      {
        type: "task.create",
        projectId,
        featureId,
        statusId: (await repo.getWorkspace(owner)).statuses[0].id,
        title: "Privada",
        description: "",
        priority: "medium",
        dueDate: null,
        labels: [],
        leaderId: owner.id,
      },
      owner,
    )
  ).createdId!;
  const scopes: [EntityKind, string][] = [
    ["project", projectId],
    ["module", moduleId],
    ["feature", featureId],
    ["task", taskId],
  ];
  return {
    repo,
    docs,
    draw,
    owner,
    reader,
    outsider,
    projectId,
    moduleId,
    featureId,
    taskId,
    scopes,
  };
}

test("documentos: cuatro ámbitos, permisos heredados, aislamiento y conflicto atómico", async () => {
  const f = await fixture();
  try {
    for (const [kind, id] of f.scopes) {
      const doc = await f.docs.create(f.owner, kind, id, payload());
      const listing = await f.docs.list(f.owner, kind, id);
      assert.equal(listing.documents.length, 1);
      assert.equal("content" in listing.documents[0], false);
      assert.equal((await f.docs.get(actor, doc.id)).scope.kind, kind);
      await assert.rejects(f.docs.get(f.outsider, doc.id), { status: 404 });
      await assert.rejects(f.docs.create(f.reader, kind, id, payload()), {
        status: kind === "task" ? 404 : 403,
      });
      if (kind !== "task") {
        assert.equal(
          (await f.docs.get(f.reader, doc.id)).permissions.canEdit,
          false,
        );
        await assert.rejects(f.docs.save(f.reader, doc.id, 1, payload()), {
          status: 403,
        });
        await assert.rejects(f.docs.remove(f.reader, doc.id), { status: 403 });
      }
      const saves = await Promise.allSettled([
        f.docs.save(f.owner, doc.id, 1, payload("Uno")),
        f.docs.save(f.owner, doc.id, 1, payload("Dos")),
      ]);
      assert.equal(
        saves.filter((result) => result.status === "fulfilled").length,
        1,
      );
      assert.equal(
        (
          saves.find(
            (result) => result.status === "rejected",
          ) as PromiseRejectedResult
        ).reason.status,
        409,
      );
      await assert.rejects(
        f.docs.save(f.owner, doc.id, 2, {
          ...payload(),
          content: "x".repeat(30001),
        }),
        { status: 400 },
      );
      assert.equal((await f.docs.get(f.owner, doc.id)).revision, 2);
    }
  } finally {
    await f.repo.close();
  }
});

test("diagramas insertables: antecesores actuales, exclusión de hermanos y otros proyectos, General y revocación", async () => {
  const f = await fixture();
  try {
    const diagrams = [];
    for (const [kind, id] of f.scopes)
      diagrams.push(
        await f.draw.create(f.owner, kind, id, {
          title: kind,
          description: "",
          scene: emptyDiagramScene(),
        }),
      );
    for (let i = 0; i < f.scopes.length; i++) {
      const [kind, id] = f.scopes[i];
      assert.deepEqual(
        new Set(
          (await f.docs.diagramOptions(f.owner, kind, id)).diagrams.map(
            (d) => d.id,
          ),
        ),
        new Set(diagrams.slice(0, i + 1).map((d) => d.id)),
      );
    }
    await assert.rejects(
      f.docs.diagram(f.owner, "project", f.projectId, diagrams[3].id),
      { status: 404 },
    );
    const sibling = (
      await f.repo.execute(
        {
          type: "module.create",
          projectId: f.projectId,
          name: "Hermano",
          description: "",
        },
        f.owner,
      )
    ).createdId!;
    const siblingDraw = await f.draw.create(f.owner, "module", sibling, {
      title: "Ajeno",
      description: "",
      scene: emptyDiagramScene(),
    });
    await assert.rejects(
      f.docs.diagram(f.owner, "task", f.taskId, siblingDraw.id),
      { status: 404 },
    );
    const otherProject = (
      await f.repo.execute(
        {
          type: "project.create",
          name: "Otro",
          description: "",
          color: "#059669",
          icon: "O",
        },
        f.owner,
      )
    ).createdId!;
    const otherDraw = await f.draw.create(f.owner, "project", otherProject, {
      title: "Otro",
      description: "",
      scene: emptyDiagramScene(),
    });
    await assert.rejects(
      f.docs.diagram(f.owner, "task", f.taskId, otherDraw.id),
      { status: 404 },
    );
    await f.draw.save(f.owner, diagrams[0].id, 1, {
      title: "Actualizado",
      description: "",
      scene: emptyDiagramScene(),
    });
    assert.equal(
      (await f.docs.diagram(f.reader, "feature", f.featureId, diagrams[0].id))
        .revision,
      2,
    );
    await f.repo.execute(
      {
        type: "feature.update",
        id: f.featureId,
        name: "Feature",
        description: "",
        moduleId: null,
      },
      f.owner,
    );
    await assert.rejects(
      f.docs.diagram(f.owner, "task", f.taskId, diagrams[1].id),
      { status: 404 },
    );
    assert.equal(
      (await f.docs.diagramOptions(f.owner, "task", f.taskId)).diagrams.length,
      3,
    );
    await f.draw.remove(f.owner, diagrams[0].id);
    await assert.rejects(
      f.docs.diagram(f.owner, "task", f.taskId, diagrams[0].id),
      { status: 404 },
    );
    await f.repo.execute(
      {
        type: "project.team.remove",
        projectId: f.projectId,
        userId: f.reader.id,
      },
      f.owner,
    );
    await assert.rejects(
      f.docs.diagramOptions(f.reader, "feature", f.featureId),
      { status: 404 },
    );
  } finally {
    await f.repo.close();
  }
});

test("documentos: imágenes protegidas, respaldos v9 y compatibilidad v8; cascadas y traslado a General", async () => {
  const f = await fixture(),
    directory = await mkdtemp(join(tmpdir(), "taskode-documents-"));
  try {
    const files = new FileManager(f.repo, new LocalFileStorage(directory));
    const bytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aPZ8AAAAASUVORK5CYII=",
      "base64",
    );
    const upload = await files.begin(f.owner, {
      projectId: f.projectId,
      name: "imagen.png",
      purpose: "image",
      size: bytes.length,
    });
    await files.put(
      f.owner,
      upload.id,
      new Request("http://localhost/upload", { method: "PUT", body: bytes }),
    );
    await files.complete(f.owner, upload.id);
    const doc = await f.docs.create(f.owner, "feature", f.featureId, {
      ...payload(),
      content: `![Imagen](/api/files/${upload.id}/content)`,
    });
    await assert.rejects(files.remove(f.owner, upload.id), { status: 409 });
    const moduleDoc = await f.docs.create(
      f.owner,
      "module",
      f.moduleId,
      payload(),
    );
    const path = join(directory, "backup.json");
    await f.repo.exportBackup(path);
    const backup = JSON.parse(await readFile(path, "utf8"));
    assert.equal(backup.version, 9);
    assert.equal(backup.tables.documents.length, 2);
    const corrupt = structuredClone(backup);
    corrupt.tables.documents[0].projectId = "missing";
    assert.throws(() => validateApplicationBackup(corrupt));
    const legacy = structuredClone(backup);
    legacy.version = 8;
    delete legacy.tables.documents;
    legacy.tables.files[0].purpose = "document";
    assert.deepEqual(validateApplicationBackup(legacy).tables.documents, []);
    assert.equal(
      validateApplicationBackup(legacy).tables.files[0].purpose,
      "file",
    );
    await f.repo.restoreBackup(path);
    assert.equal((await f.docs.get(f.owner, doc.id)).content, doc.content);
    await f.repo.execute({ type: "module.delete", id: f.moduleId }, f.owner);
    await assert.rejects(f.docs.get(f.owner, moduleDoc.id), { status: 404 });
    assert.equal((await f.docs.get(f.owner, doc.id)).scope.id, f.featureId);
    await f.docs.save(f.owner, doc.id, 1, payload());
    await files.remove(f.owner, upload.id);
    await f.repo.execute({ type: "feature.delete", id: f.featureId }, f.owner);
    await assert.rejects(f.docs.get(f.owner, doc.id), { status: 404 });
  } finally {
    await f.repo.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("Markdown: diagramas conservan referencias, texto normal y bloques de código al editar", () => {
  const schema = getSchema([StarterKit, DiagramReference]);
  assert.equal(
    schema.topNodeType.createAndFill()?.firstChild?.type.name,
    "paragraph",
  );
  const manager = new MarkdownManager({
    marked: createMarkdownParser(),
    extensions: [
      StarterKit,
      DescriptionImage,
      MarkdownYoutube,
      DiagramReference,
    ],
  });
  const path = diagramReferencePath(
    "proyecto",
    "00000000-0000-4000-8000-000000000000",
  );
  const markdown = `## Guía\n\n[Flujo principal](${path})\n\nTexto **importante** y [enlace](https://example.com).\n\n\`\`\`md\n[Ejemplo](${path})\n\`\`\``;
  const parsed = manager.parse(markdown),
    saved = manager.serialize(parsed);
  assert.equal(
    parsed.content?.filter((node) => node.type === "diagramReference").length,
    1,
  );
  assert.deepEqual(manager.parse(saved), parsed);
  assert.match(saved, /Flujo principal/);
  assert.match(saved, /https:\/\/example.com/);
  assert.equal(parseDiagramReference("javascript:alert(1)"), null);
  assert.equal(
    parseDiagramReference(
      "/projects/%ZZ/diagrams/00000000-0000-4000-8000-000000000000",
    ),
    null,
  );
  const image =
    "![Nota](/api/files/00000000-0000-4000-8000-000000000000/content)";
  const media = manager.parse(`${image}\n\n[Flujo](${path})\n\n${image}`);
  assert.equal(
    media.content?.filter((node) => node.type === "image").length,
    2,
  );
  assert.deepEqual(manager.parse(manager.serialize(media)), media);
});
