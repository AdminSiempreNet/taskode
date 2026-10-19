import { stripTicketTables } from "./entity-fixtures";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, inArray } from "drizzle-orm";
import { MarkdownManager } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import {
  contentMentions,
  mentionMarkdown,
  mentionQuery,
  parseMention,
} from "../src/lib/mentions";
import { Mention } from "../src/components/mentions";
import { createMarkdownParser } from "../src/lib/markdown-parser";
import { MentionsService } from "../src/server/mentions";
import { DocumentsService } from "../src/server/documents";
import { actor, addUser, createRepository } from "./helpers";
import * as s from "../src/server/schema";
import type { EntityRef } from "../src/lib/types";
import type { Command } from "../src/lib/validation";
import { validateApplicationBackup } from "../src/server/backup-data";

test("menciones Markdown: referencias estables, nombres escapados, enlaces normales y código", () => {
  assert.deepEqual(mentionQuery("😀@ange"), {
    type: "user",
    query: "ange",
    start: 2,
  });
  assert.equal(mentionQuery("correo@example.com"), null);
  assert.equal(mentionQuery("https://example.com/?@ana"), null);
  assert.equal(mentionQuery("www.example.com/@ana"), null);
  const manager = new MarkdownManager({
    extensions: [StarterKit, Mention, Image],
    marked: createMarkdownParser(),
  });
  const user = { type: "user" as const, id: "usuario/con espacio" };
  const source = `${mentionMarkdown(user, "Ana [QA] \\ Pérez")} y [Sitio](https://example.com)\n\n\`${mentionMarkdown(user, "Ejemplo")}\`\n\n![Imagen](/mentions/users/falso)`;
  assert.deepEqual(contentMentions(source), [user]);
  assert.equal(parseMention("/mentions/users/%ZZ"), null);
  const parsed = manager.parse(source);
  const saved = manager.serialize(parsed);
  assert.deepEqual(manager.parse(saved), parsed);
  assert.ok(JSON.stringify(parsed).includes('"type":"mention"'));
  assert.match(saved, /https:\/\/example.com/);
  assert.deepEqual(contentMentions(saved), [user]);
});

async function fixture() {
  const repo = await createRepository();
  const member = await addUser(repo, "mentions-member"),
    reader = await addUser(repo, "mentions-reader"),
    outsider = await addUser(repo, "mentions-outsider");
  const projectId = (
    await repo.execute(
      {
        type: "project.create",
        name: "Menciones",
        description: "",
        icon: "M",
        color: "#059669",
      },
      actor,
    )
  ).createdId!;
  for (const user of [member, reader])
    await repo.execute(
      { type: "project.team.add", projectId, userId: user.id },
      actor,
    );
  const moduleId = (
    await repo.execute(
      { type: "module.create", projectId, name: "Módulo", description: "" },
      actor,
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
      actor,
    )
  ).createdId!;
  const workspace = await repo.getWorkspace(actor);
  const taskId = (
    await repo.execute(
      {
        type: "task.create",
        projectId,
        featureId,
        statusId: workspace.statuses[0].id,
        priority: "medium",
        title: "Tarea",
        description: "",
        dueDate: null,
        labels: [],
        leaderId: actor.id,
        teamMemberIds: [member.id],
      },
      actor,
    )
  ).createdId!;
  const scopes: EntityRef[] = [
    { kind: "project", id: projectId, projectId },
    { kind: "module", id: moduleId, projectId },
    { kind: "feature", id: featureId, projectId },
    { kind: "task", id: taskId, projectId },
  ];
  const mentions = new MentionsService(repo),
    docs = new DocumentsService(repo);
  const text = mentionMarkdown({ type: "user", id: member.id }, "Miembro");
  const inbox = async () =>
    (await repo.notifications.list(member)).items.filter(
      (n) => n.type === "mention",
    );
  return {
    repo,
    member,
    reader,
    outsider,
    scopes,
    mentions,
    docs,
    text,
    inbox,
    projectId,
    taskId,
    featureId,
  };
}

test("candidatos respetan visibilidad y calculan el acceso de borradores", async () => {
  const f = await fixture();
  try {
    const project = await f.mentions.options(actor, { scope: f.scopes[0] });
    assert.ok(project.users.some((u) => u.id === f.reader.id));
    assert.ok(project.users.every((u) => u.email && u.image === null));
    const task = await f.mentions.options(actor, { scope: f.scopes[3] });
    assert.ok(task.users.some((u) => u.id === f.member.id));
    assert.ok(
      !task.users.some((u) => u.id === f.reader.id || u.id === f.outsider.id),
    );
    await assert.rejects(f.mentions.options(f.reader, { scope: f.scopes[3] }), {
      status: 404,
    });
    const draft = await f.mentions.options(actor, {
      draft: {
        kind: "task",
        projectId: f.projectId,
        featureId: f.featureId,
        leaderId: f.reader.id,
      },
    });
    assert.ok(draft.users.some((u) => u.id === f.reader.id));
    assert.ok(!draft.users.some((u) => u.id === f.member.id));
    assert.deepEqual(
      (
        await f.mentions.options(actor, { draft: { kind: "project" } })
      ).users.map((u) => u.id),
      [actor.id],
    );
  } finally {
    await f.repo.close();
  }
});

test("las cuatro entidades notifican en comentarios, descripciones y documentos con destinos precisos", async () => {
  const f = await fixture();
  try {
    const sessionId = randomUUID();
    await f.repo.store.db.insert(s.session).values({
      id: sessionId,
      userId: f.member.id,
      token: randomUUID(),
      expiresAt: new Date(Date.now() + 86400000),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await f.repo.store.db.insert(s.pushSubscriptions).values({
      id: randomUUID(),
      userId: f.member.id,
      sessionId,
      endpoint: "https://push.example.test/subscription",
      p256dh: "test-key",
      auth: "test-auth",
    });
    for (const scope of f.scopes) {
      const requestId = randomUUID();
      const command = {
        type: "comment.create" as const,
        scope,
        content: `${f.text} ${f.text}`,
        requestId,
      };
      await f.repo.execute(command, actor);
      await f.repo.execute(command, actor);
      const { entity } = await f.repo.requireEntity(
        actor,
        scope.kind,
        scope.id,
      );
      await f.repo.execute(
        {
          ...entity,
          type: `${scope.kind}.update`,
          description: f.text,
        } as Command,
        actor,
      );
      const doc = await f.docs.create(actor, scope.kind, scope.id, {
        title: "Manual",
        description: "",
        content: f.text,
      });
      const items = await f.inbox();
      assert.equal(items.filter((n) => n.scope?.id === scope.id).length, 3);
      const comment = items.find((n) => n.commentId === requestId)!;
      assert.match(
        (await f.repo.notifications.get(f.member, comment.id)).url,
        new RegExp(`#comment-${requestId}$`),
      );
      const document = items.find((n) => n.documentId === doc.id)!;
      assert.match(
        (await f.repo.notifications.get(f.member, document.id)).url,
        new RegExp(`tab=documents&document=${doc.id}`),
      );
      await f.docs.save(actor, doc.id, doc.revision, {
        title: doc.title,
        description: "",
        content: f.text + " sin cambios de destinatario",
      });
      assert.equal((await f.inbox()).length, items.length);
      await assert.rejects(
        f.docs.save(actor, doc.id, doc.revision, {
          title: doc.title,
          description: "",
          content: f.text,
        }),
        { status: 409 },
      );
    }
    assert.equal((await f.inbox()).length, 12);
    const jobs = await f.repo.store.db
      .select()
      .from(s.notificationDeliveries)
      .where(
        inArray(
          s.notificationDeliveries.notificationId,
          (await f.inbox()).map((n) => n.id),
        ),
      );
    assert.equal(jobs.length, 12);
    assert.ok(jobs.every((j) => j.transport === "ably"));
    await f.repo.notifications.read(f.member, {
      through: (await f.repo.notifications.list(f.member)).through!,
    });
    assert.equal((await f.repo.notifications.list(f.member)).unreadCount, 0);
  } finally {
    await f.repo.close();
  }
});

test("migración 0011 conserva los avisos existentes y completa su ámbito", async () => {
  const f = await fixture();
  try {
    const before = await f.repo.store.db.select().from(s.notifications);
    assert.ok(before.length);
    await f.repo.store.pool.query(
      'alter table notifications drop column "projectId", drop column "scopeType", drop column "moduleId", drop column "featureId", drop column "commentId", drop column "documentId"; alter table notifications alter column "taskId" set not null',
    );
    await f.repo.store.pool.query(
      await readFile("drizzle/postgresql/0011_mentions.sql", "utf8"),
    );
    assert.deepEqual(
      await f.repo.store.db.select().from(s.notifications),
      before,
    );
    assert.equal(
      (await f.repo.notifications.list(f.member)).items[0].taskId,
      f.taskId,
    );
  } finally {
    await f.repo.close();
  }
});

test("las descripciones admiten menciones desde la creación incluso si el autor cede la tarea", async () => {
  const f = await fixture();
  try {
    const moduleId = (
      await f.repo.execute(
        {
          type: "module.create",
          projectId: f.projectId,
          name: "Nuevo",
          description: f.text,
        },
        actor,
      )
    ).createdId!;
    const featureId = (
      await f.repo.execute(
        {
          type: "feature.create",
          projectId: f.projectId,
          moduleId,
          name: "Nueva",
          description: f.text,
        },
        actor,
      )
    ).createdId!;
    const workspace = await f.repo.getWorkspace(actor);
    const taskId = (
      await f.repo.execute(
        {
          type: "task.create",
          projectId: f.projectId,
          featureId,
          statusId: workspace.statuses[0].id,
          title: "Delegada",
          description: f.text,
          priority: "medium",
          dueDate: null,
          labels: [],
          leaderId: f.member.id,
          teamMemberIds: [],
        },
        f.reader,
      )
    ).createdId!;
    await assert.rejects(f.repo.requireTask(f.reader, taskId), { status: 404 });
    assert.equal((await f.inbox()).length, 3);
  } finally {
    await f.repo.close();
  }
});

test("ediciones, automenciones, referencias no válidas y pérdidas de acceso son atómicas", async () => {
  const f = await fixture();
  try {
    const scope = f.scopes[3];
    const id = (
      await f.repo.execute(
        { type: "comment.create", scope, content: f.text },
        actor,
      )
    ).createdId!;
    const original = (await f.inbox())[0];
    await f.repo.execute(
      { type: "comment.update", id, content: f.text + " editado" },
      actor,
    );
    assert.equal((await f.inbox()).length, 1);
    await f.repo.execute(
      { type: "comment.update", id, content: "Sin menciones" },
      actor,
    );
    await f.repo.execute(
      { type: "comment.update", id, content: f.text },
      actor,
    );
    assert.equal((await f.inbox()).length, 2);
    const invalid = mentionMarkdown(
      { type: "user", id: f.reader.id },
      "Sin acceso",
    );
    await assert.rejects(
      f.repo.execute(
        { type: "comment.create", scope, content: f.text + invalid },
        actor,
      ),
      /no tiene acceso/,
    );
    assert.equal((await f.inbox()).length, 2);
    await f.repo.execute(
      {
        type: "comment.create",
        scope,
        content: mentionMarkdown({ type: "user", id: actor.id }, "Yo"),
      },
      actor,
    );
    assert.equal((await f.repo.notifications.list(actor)).items.length, 0);
    await f.repo.execute(
      {
        type: "task.assignment.update",
        id: f.taskId,
        leaderId: actor.id,
        teamMemberIds: [],
      },
      actor,
    );
    await assert.rejects(f.repo.notifications.get(f.member, original.id), {
      status: 404,
    });
    assert.equal((await f.inbox()).length, 0);
    // The old reference remains editable after its recipient lost access.
    await f.repo.execute(
      { type: "comment.update", id, content: f.text + " histórico" },
      actor,
    );
    await f.repo.execute({ type: "comment.delete", id }, actor);
    assert.equal(
      (
        await f.repo.store.db
          .select()
          .from(s.notifications)
          .where(eq(s.notifications.commentId, id))
      ).length,
      0,
    );
  } finally {
    await f.repo.close();
  }
});

test("clientes: mencionar no asocia clientes ni genera avisos", async () => {
  const f = await fixture();
  try {
    const geography = await f.repo.getGeography(actor);
    const clientId = (
      await f.repo.execute(
        {
          type: "client.create",
          name: "Cliente",
          cityId: geography.cities[0].id,
        },
        actor,
      )
    ).createdId!;
    await f.repo.execute(
      {
        type: "comment.create",
        scope: f.scopes[3],
        content: mentionMarkdown({ type: "client", id: clientId }, "Cliente"),
      },
      actor,
    );
    assert.equal((await f.inbox()).length, 0);
    assert.deepEqual(
      (await f.repo.getWorkspace(actor)).tasks.find((t) => t.id === f.taskId)!
        .clientIds,
      [],
    );
  } finally {
    await f.repo.close();
  }
});

test("respaldo v11 conserva menciones y normaliza avisos v9 sin generar entregas", async () => {
  const f = await fixture(),
    directory = await mkdtemp(join(tmpdir(), "mentions-backup-"));
  try {
    await f.docs.create(actor, "project", f.projectId, {
      title: "Manual",
      description: "",
      content: f.text,
    });
    const path = join(directory, "backup.json");
    await f.repo.exportBackup(path);
    const backup = JSON.parse(await readFile(path, "utf8"));
    assert.equal(validateApplicationBackup(backup).version, 11);
    const legacy = structuredClone(backup);
    stripTicketTables(legacy.tables);
    legacy.version = 9;
    legacy.tables.notifications = legacy.tables.notifications.filter(
      (n: { type: string }) => n.type !== "mention",
    );
    for (const n of legacy.tables.notifications)
      for (const key of [
        "projectId",
        "scopeType",
        "moduleId",
        "featureId",
        "commentId",
        "documentId",
      ])
        delete n[key];
    const normalized = validateApplicationBackup(legacy);
    assert.equal(normalized.tables.notifications[0].projectId, f.projectId);
    await f.repo.restoreBackup(path);
    assert.equal((await f.inbox()).length, 1);
    assert.equal(
      (await f.repo.store.db.select().from(s.notificationDeliveries)).length,
      0,
    );
  } finally {
    await f.repo.close();
    await rm(directory, { recursive: true, force: true });
  }
});
