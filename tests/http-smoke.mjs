import { startHttpFixture } from "./http-fixture.ts";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

let base, fixture;
before(async () => {
  fixture = await startHttpFixture();
  base = fixture.base;
});
after(async () => {
  await fixture?.stop();
});
const fetch = (url, init = {}) => {
  const headers = new Headers(init.headers);
  headers.set("Cookie", fixture.cookie);
  return globalThis.fetch(url, { ...init, headers });
};
async function send(command, expected = 200) {
  const r = await fetch(base + "/api/workspace", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  const data = await r.json();
  assert.equal(r.status, expected, JSON.stringify(data));
  return data;
}
test("HTTP: página de tarea, inicio/fin, catálogos, checklist y comentarios persisten", async () => {
  let projectId;
  try {
    const created = await send({
      type: "project.create",
      name: "Prueba temporal de detalle",
      description: "",
      icon: "📋",
      color: "#3b82f6",
    });
    projectId = created.createdId;
    const featureId = created.workspace.features.find(
      (f) => f.projectId === projectId,
    ).id;
    const statusId = created.workspace.statuses.find(
      (s) => s.projectId === projectId,
    ).id;
    const priority = (
      await send({
        type: "priority.create",
        projectId,
        name: "Urgente",
        color: "#ef4444",
      })
    ).createdId;
    await send({
      type: "label.create",
      projectId,
      name: "Diseño",
      color: "#8b5cf6",
    });
    const task = {
      type: "task.create",
      projectId,
      featureId,
      statusId,
      title: "Tarea con duración",
      description: "Detalle persistente",
      priority,
      ticketNumber: "001234",
      typeId: created.workspace.taskTypes.find(
        (option) => option.projectId === projectId,
      ).id,
      impactId: created.workspace.impacts.find(
        (option) => option.projectId === projectId,
      ).id,
      labels: ["Diseño"],
      startDate: "2026-10-15",
      startTime: "09:00",
      dueDate: "2026-10-15",
      dueTime: "11:30",
    };
    const taskId = (await send(task)).createdId;
    const route = `/projects/${projectId}/tasks/${taskId}`;
    const page = await fetch(base + route);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Tarea con duración/);
    assert.equal(
      (await fetch(base + `/projects/${projectId}/tasks/new`)).status,
      200,
    );
    assert.equal(
      (await fetch(base + `/projects/${projectId}/tasks/${randomUUID()}`))
        .status,
      404,
    );
    const listId = (
      await send({ type: "checklist.create", taskId, title: "Revisiones" })
    ).createdId;
    const itemId = (
      await send({
        type: "checklist.item.create",
        checklistId: listId,
        title: "Verificar",
      })
    ).createdId;
    await send({
      type: "checklist.item.update",
      id: itemId,
      title: "Verificado",
      completed: true,
    });
    const commentId = (
      await send({
        type: "comment.create",
        taskId,
        content: "Primer comentario",
      })
    ).createdId;
    await send({
      type: "comment.update",
      id: commentId,
      content: "Comentario editado",
    });
    const fresh = await (await fetch(base + "/api/workspace")).json();
    const saved = fresh.tasks.find((t) => t.id === taskId);
    assert.equal(saved.startDate, task.startDate);
    assert.equal(saved.startTime, task.startTime);
    assert.equal(saved.typeId, task.typeId);
    assert.equal(saved.impactId, task.impactId);
    assert.equal(saved.ticketNumber, "001234");
    assert.equal(saved.checklists[0].items[0].completed, true);
    assert.equal(saved.comments[0].content, "Comentario editado");
    const reloaded = await fetch(base + route);
    assert.equal(reloaded.status, 200);
    const reloadedHtml = await reloaded.text();
    assert.match(reloadedHtml, /Comentario editado/);
    assert.match(reloadedHtml, /Verificado/);
    assert.match(reloadedHtml, /Tipo \(opcional\)/);
    assert.match(reloadedHtml, /Impacto \(opcional\)/);
    const renamed = await send({
      type: "task.rename",
      id: taskId,
      title: "Título editado inline",
    });
    assert.equal(
      renamed.workspace.tasks.find((t) => t.id === taskId).title,
      "Título editado inline",
    );
    await send({ ...task, startTime: "12:00" }, 400);
    await send({ type: "priority.delete", projectId, id: priority }, 400);
    await send({ type: "taskType.delete", projectId, id: task.typeId }, 400);
    await send({ type: "impact.delete", projectId, id: task.impactId }, 400);
    const cleared = await send({
      ...task,
      type: "task.update",
      id: taskId,
      typeId: null,
      impactId: null,
    });
    const clearedTask = cleared.workspace.tasks.find((t) => t.id === taskId);
    assert.equal(clearedTask.typeId, null);
    assert.equal(clearedTask.impactId, null);
    await send({ type: "comment.delete", id: commentId });
    await send({ type: "checklist.delete", id: listId });
    const backup = await fetch(base + "/api/backup");
    assert.equal(backup.status, 200);
    assert.equal(
      Buffer.from(await backup.arrayBuffer())
        .subarray(0, 16)
        .toString(),
      "SQLite format 3\0",
    );
    await send({ type: "task.delete", id: taskId });
    assert.equal((await fetch(base + route)).status, 404);
  } finally {
    if (projectId) await send({ type: "project.delete", id: projectId });
  }
});
test("HTTP: página y todos sus assets JS/CSS responden correctamente", async () => {
  const r = await fetch(base);
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /<html lang="es"/);
  assert.match(html, /Brote/);
  const assets = [
    ...new Set(
      [...html.matchAll(/(?:src|href)="([^\"]*\/_next\/static\/[^\"]+)"/g)].map(
        (m) => m[1].replaceAll("&amp;", "&"),
      ),
    ),
  ];
  assert.ok(assets.length > 0);
  for (const path of assets) {
    const response = await fetch(new URL(path, base));
    assert.equal(response.status, 200, path);
  }
});
test("HTTP: rutas de proyectos, enlaces antiguos, recarga y proyecto eliminado", async () => {
  let projectId;
  try {
    const created = await send({
      type: "project.create",
      name: "Proyecto temporal de rutas",
      description: "Verificación de rutas dinámicas.",
      icon: "📋",
      color: "#059669",
    });
    projectId = created.createdId;
    const path = `/projects/${encodeURIComponent(projectId)}`;
    for (const entry of ["/", "/projects"]) {
      const root = await fetch(new URL(entry, base), { redirect: "manual" });
      assert.equal(root.status, 307);
      assert.equal(
        root.headers.get("location"),
        `/projects/${created.workspace.projects[0].id}`,
      );
    }

    for (const url of [path, path, path + "?project=ignorado"]) {
      const response = await fetch(base + url);
      assert.equal(response.status, 200);
      assert.equal(new URL(response.url).pathname, path);
      assert.match(
        await response.text(),
        /<h1[^>]*>Proyecto temporal de rutas<\/h1>/,
      );
    }

    const legacy = await fetch(base + `/?project=${projectId}`, {
      redirect: "manual",
    });
    assert.equal(legacy.status, 307);
    assert.equal(legacy.headers.get("location"), path);

    const missing = await fetch(base + `/projects/${randomUUID()}`);
    assert.equal(missing.status, 404);
    assert.match(await missing.text(), /Proyecto no encontrado/);

    const deleted = await send({ type: "project.delete", id: projectId });
    const removedPath = path;
    projectId = undefined;
    assert.equal((await fetch(base + removedPath)).status, 404);
    const landing = await fetch(base, { redirect: "manual" });
    if (deleted.workspace.projects.length) {
      assert.equal(landing.status, 307);
      assert.equal(
        landing.headers.get("location"),
        `/projects/${deleted.workspace.projects[0].id}`,
      );
    } else {
      assert.equal(landing.status, 200);
      assert.match(await landing.text(), /Todo empieza con una idea/);
    }
  } finally {
    if (projectId) await send({ type: "project.delete", id: projectId });
  }
});
test("HTTP: JSON inválido, fechas imposibles y solicitudes de otro origen se rechazan", async () => {
  const invalid = await fetch(base + "/api/workspace", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{invalid",
  });
  assert.equal(invalid.status, 400);
  const foreign = await fetch(base + "/api/workspace", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://otro-sitio.example",
    },
    body: "{}",
  });
  assert.equal(foreign.status, 403);
  const malformed = await fetch(base + "/api/workspace", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "null" },
    body: "{}",
  });
  assert.equal(malformed.status, 403);
});
test("HTTP: orden y fijadas se guardan, y la sexta fijada se rechaza con un error visible", async () => {
  let projectId;
  try {
    const created = await send({
      type: "project.create",
      name: "Features temporales HTTP",
      description: "",
      icon: "📋",
      color: "#059669",
    });
    projectId = created.createdId;
    let workspace = created.workspace;
    for (let i = 0; i < 5; i++)
      workspace = (
        await send({
          type: "feature.create",
          projectId,
          name: `Feature HTTP ${i}`,
          description: "",
        })
      ).workspace;
    const ids = workspace.features
      .filter((feature) => feature.projectId === projectId)
      .map((feature) => feature.id);
    for (const id of ids.slice(0, 5))
      await send({ type: "feature.pin", id, pinned: true });
    const rejected = await send(
      { type: "feature.pin", id: ids[5], pinned: true },
      400,
    );
    assert.match(rejected.error, /máximo de 5/);
    await send({ type: "feature.pin", id: ids[0], pinned: false });
    await send({ type: "feature.pin", id: ids[5], pinned: true });
    const order = ids.toReversed();
    const reordered = await send({
      type: "feature.reorder",
      projectId,
      ids: order,
    });
    assert.deepEqual(
      reordered.workspace.features
        .filter((feature) => feature.projectId === projectId)
        .map((feature) => feature.id),
      order,
    );
    const fresh = await (await fetch(base + "/api/workspace")).json();
    assert.equal(
      fresh.features.filter(
        (feature) => feature.projectId === projectId && feature.pinned,
      ).length,
      5,
    );
    assert.deepEqual(
      fresh.features
        .filter((feature) => feature.projectId === projectId)
        .map((feature) => feature.id),
      order,
    );
    await send(
      { type: "feature.reorder", projectId, ids: order.slice(1) },
      400,
    );
  } finally {
    if (projectId) await send({ type: "project.delete", id: projectId });
  }
});
test("HTTP: crear, editar, mover, archivar, restaurar, importar, respaldar y eliminar", async () => {
  const dir = await mkdtemp(join(tmpdir(), "brote-http-"));
  let projectId;
  try {
    const created = await send({
      type: "project.create",
      name: "Verificación HTTP temporal",
      description: "Datos creados por la prueba y eliminados al terminar.",
      icon: "🛠️",
      color: "#059669",
    });
    projectId = created.createdId;
    const statuses = created.workspace.statuses.filter(
      (s) => s.projectId === projectId,
    );
    const featureId = created.workspace.features.find(
      (f) => f.projectId === projectId,
    ).id;
    const task = {
      type: "task.create",
      projectId,
      featureId,
      statusId: statuses[0].id,
      title: "Tarea HTTP",
      description: "Verificación",
      priority: "high",
      dueDate: "2026-10-15",
      dueTime: "09:30",
      labels: ["Prueba"],
    };
    await send({ ...task, dueDate: "2026-02-30" }, 400);
    await send({ ...task, dueTime: "24:00" }, 400);
    await send({ ...task, dueDate: null }, 400);
    const added = await send(task);
    const id = added.createdId;
    assert.ok(id);
    assert.equal(
      added.workspace.tasks.find((t) => t.id === id).dueTime,
      "09:30",
    );
    await send({ ...task, type: "task.update", id, title: "Tarea editada" });
    const moved = await send({
      type: "task.move",
      id,
      statusId: statuses[1].id,
      beforeId: null,
    });
    assert.equal(
      moved.workspace.tasks.find((t) => t.id === id).statusId,
      statuses[1].id,
    );
    const archived = await send({ type: "task.archive", id, archived: true });
    assert.equal(
      archived.workspace.tasks.find((t) => t.id === id).archived,
      true,
    );
    assert.equal(
      archived.workspace.tasks.find((t) => t.id === id).dueTime,
      "09:30",
    );
    await send({ type: "status.delete", id: statuses[1].id }, 400);
    await send({ type: "task.archive", id, archived: false });
    const board = {
      name: "Tablero de prueba",
      lists: [{ id: "list-http", name: "Desde Trello" }],
      cards: [
        {
          id: "card-http",
          name: "Importada por HTTP",
          idList: "list-http",
          desc: "Detalle",
          due: "2026-11-01T12:00:00Z",
          labels: [{ name: "Web" }],
        },
      ],
    };
    const imported = await send({ type: "trello.import", projectId, board });
    assert.equal(imported.report.imported, 1);
    const repeated = await send({ type: "trello.import", projectId, board });
    assert.equal(repeated.report.skipped, 1);
    const response = await fetch(base + "/api/backup");
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-disposition"), /\.sqlite/);
    const buffer = Buffer.from(await response.arrayBuffer());
    assert.equal(buffer.subarray(0, 16).toString(), "SQLite format 3\0");
    const path = join(dir, "backup.sqlite");
    await writeFile(path, buffer);
    const copy = new DatabaseSync(path);
    try {
      assert.equal(
        copy.prepare("PRAGMA integrity_check").get().integrity_check,
        "ok",
      );
      assert.equal(
        copy
          .prepare("SELECT COUNT(*) AS n FROM tasks WHERE projectId=?")
          .get(projectId).n,
        2,
      );
      assert.equal(
        copy.prepare("SELECT dueTime FROM tasks WHERE id=?").get(id).dueTime,
        "09:30",
      );
    } finally {
      copy.close();
    }
    await send({ type: "task.delete", id });
  } finally {
    if (projectId) {
      const removed = await send({ type: "project.delete", id: projectId });
      assert.ok(!removed.workspace.projects.some((p) => p.id === projectId));
      assert.ok(
        !removed.workspace.tasks.some((t) => t.projectId === projectId),
      );
    }
    await rm(dir, {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 50,
    });
  }
});

test("HTTP: páginas y API requieren sesión; healthcheck y login son públicos", async () => {
  for (const path of [
    "/api/workspace",
    "/api/backup",
    "/api/backups",
    "/api/invitations",
    "/api/users",
  ]) {
    const r = await globalThis.fetch(base + path);
    assert.equal(r.status, 401, path);
  }
  const home = await globalThis.fetch(base, { redirect: "manual" });
  assert.equal(home.status, 307);
  assert.equal(new URL(home.headers.get("location"), base).pathname, "/login");
  const login = await globalThis.fetch(base + "/login");
  assert.equal(login.status, 200);
  const html = await login.text();
  assert.match(html, /Continuar con Google/);
  assert.match(html, /Continuar con GitHub/);
  assert.equal((await globalThis.fetch(base + "/api/health")).status, 200);
});

test("HTTP: cerrar sesión revoca la sesión almacenada", async () => {
  const response = await fetch(base + "/api/auth/sign-out", {
    method: "POST",
    headers: { Origin: base, "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(response.status, 200);
  assert.equal((await fetch(base + "/api/workspace")).status, 401);
});
