import { startHttpFixture } from "./http-fixture.ts";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { lastProjectCookieName } from "../src/lib/project-navigation.ts";
import { addUser } from "./helpers.ts";

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
    assert.match(reloadedHtml, /for="task-typeId"[^>]*>Tipo</);
    assert.match(reloadedHtml, /for="task-impactId"[^>]*>Impacto</);
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
    assert.equal((await backup.json()).format, "taskode-backup");
    await send({ type: "task.delete", id: taskId });
    assert.equal((await fetch(base + route)).status, 404);
  } finally {
    if (projectId) await send({ type: "project.delete", id: projectId });
  }
});
test("HTTP: la landing es pública, conserva la marca y todos sus assets JS/CSS responden", async () => {
  const r = await fetch(base);
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /<html lang="es"/);
  assert.match(html, /Taskode/);
  assert.match(html, /Tu próximo deploy empieza con/);
  assert.match(html, /id="funciones"/);
  assert.match(html, /id="como-funciona"/);
  assert.match(html, /href="\/login"/);
  const publicPage = await globalThis.fetch(base);
  assert.equal(publicPage.status, 200);
  assert.match(await publicPage.text(), /Tu próximo deploy empieza con/);
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
    for (const entry of ["/projects"]) {
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
    assert.equal(legacy.headers.get("location"), `/projects?project=${projectId}`);
    const legacyProject = await fetch(new URL(legacy.headers.get("location"), base), { redirect: "manual" });
    assert.equal(legacyProject.status, 307);
    assert.equal(legacyProject.headers.get("location"), path);

    const missing = await fetch(base + `/projects/${randomUUID()}`);
    assert.equal(missing.status, 404);
    assert.match(await missing.text(), /Proyecto no encontrado/);

    const deleted = await send({ type: "project.delete", id: projectId });
    const removedPath = path;
    projectId = undefined;
    assert.equal((await fetch(base + removedPath)).status, 404);
    const landing = await fetch(base + "/projects", { redirect: "manual" });
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
test("HTTP: menú vacío, último proyecto recordado y preferencia sin acceso", async () => {
  const ids = [];
  try {
    for (const name of ["Proyecto recordado", "Proyecto alternativo"]) {
      const created = await send({ type: "project.create", name, description: "", icon: "📋", color: "#059669" });
      ids.push(created.createdId);
    }
    const remembered = ids[0];
    const cookie = `${fixture.cookie}; ${lastProjectCookieName("test-admin")}=${remembered}`;
    const get = (path, value = cookie) => globalThis.fetch(base + path, { redirect: "manual", headers: { Cookie: value } });
    const entry = await get("/projects");
    assert.equal(entry.status, 307);
    assert.equal(entry.headers.get("location"), `/projects/${remembered}`);
    const explicit = await get(`/projects?project=${ids[1]}`);
    assert.equal(explicit.headers.get("location"), `/projects/${ids[1]}`);

    const dashboard = await get("/dashboard");
    assert.equal(dashboard.status, 200);
    const html = await dashboard.text();
    assert.match(html, /aria-label="Menú principal"/);
    assert.match(html, /<h1[^>]*>Dashboard<\/h1>/);
    assert.doesNotMatch(html, /aria-label="Features del proyecto"/);
    assert.doesNotMatch(html, /Todo empieza con una idea/);
    assert.equal((await get("/projects")).headers.get("location"), `/projects/${remembered}`);

    const anonymous = await globalThis.fetch(base + "/dashboard", { redirect: "manual" });
    assert.equal(anonymous.status, 307);
    assert.equal(new URL(anonymous.headers.get("location"), base).pathname, "/login");

    await send({ type: "project.delete", id: remembered });
    ids.shift();
    const fallback = await get("/projects");
    assert.equal(fallback.status, 307);
    assert.notEqual(fallback.headers.get("location"), `/projects/${remembered}`);
    const otherUser = await get("/projects", `${fixture.cookie}; ${lastProjectCookieName("another-user")}=${ids[0]}`);
    assert.equal(otherUser.headers.get("location"), fallback.headers.get("location"));
  } finally {
    for (const id of ids) await send({ type: "project.delete", id });
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
    assert.match(
      response.headers.get("content-disposition"),
      /\.taskode-backup\.json/,
    );
    const copy = await response.json();
    assert.equal(copy.format, "taskode-backup");
    assert.equal(
      copy.tables.tasks.filter((task) => task.projectId === projectId).length,
      2,
    );
    assert.equal(
      copy.tables.tasks.find((task) => task.id === id).dueTime,
      "09:30",
    );
    await send({ type: "task.delete", id });
  } finally {
    if (projectId) {
      const removed = await send({ type: "project.delete", id: projectId });
      assert.ok(!removed.workspace.projects.some((p) => p.id === projectId));
      assert.ok(
        !removed.workspace.tasks.some((t) => t.projectId === projectId),
      );
    }
  }
});

test("HTTP: clientes globales, geografía y relación opcional con tareas", async () => {
  const geographyResponse = await fetch(base + "/api/geography");
  assert.equal(geographyResponse.status, 200);
  assert.equal(geographyResponse.headers.get("cache-control"), "no-store");
  const geography = await geographyResponse.json();
  assert.equal(geography.departments.length, 33);
  assert.equal(geography.cities.find((city) => city.id === "05001").departmentId, "05");
  const created = await send({ type: "client.create", name: "Compañía HTTP", cityId: "05001" });
  const clientId = created.createdId;
  let projectId;
  try {
    assert.equal(created.workspace.clients.find((client) => client.id === clientId).cityName, "MEDELLÍN");
    assert.equal(created.workspace.cities, undefined);
    const listing = await fetch(base + "/clients");
    assert.equal(listing.status, 200);
    const html = await listing.text();
    assert.match(html, /Compañía HTTP/);
    const clientLink = html.match(/<a\b[^>]*href="\/clients"[^>]*>/)?.[0] ?? "";
    assert.match(clientLink, /aria-current="page"/);
    await send({ type: "client.create", name: "COMPANIA HTTP", cityId: "05001" }, 409);
    await send({ type: "client.create", name: "Sin ciudad" }, 400);
    await send({ type: "client.create", name: "Ciudad inválida", cityId: "unknown" }, 400);
    const project = await send({ type: "project.create", name: "Clientes HTTP", description: "", icon: "📋", color: "#059669" });
    projectId = project.createdId;
    const fields = { projectId, featureId: project.workspace.features.find((f) => f.projectId === projectId).id,
      statusId: project.workspace.statuses.find((s) => s.projectId === projectId).id,
      title: "Tarea para cliente", description: "", priority: "medium", dueDate: null, labels: [] };
    const task = await send({ type: "task.create", ...fields, clientIds: [clientId] });
    const taskId = task.createdId;
    assert.deepEqual(task.workspace.tasks.find((t) => t.id === taskId).clientIds, [clientId]);
    await send({ type: "task.update", id: taskId, ...fields });
    const detail = await fetch(base + `/projects/${projectId}/tasks/${taskId}`);
    assert.equal(detail.status, 200);
    const detailHtml = await detail.text();
    assert.match(detailHtml, /aria-label="Ver asignación de usuarios"/);
    assert.match(detailHtml, /aria-label="Líder: test-admin"/);
    assert.doesNotMatch(detailHtml, /<section[^>]*aria-label="Usuarios"/);
    assert.doesNotMatch(detailHtml, /id="task-leader"/);
    assert.match(detailHtml, /aria-label="Propiedades"/);
    assert.match(detailHtml, /aria-label="Clientes"/);
    assert.match(detailHtml, /aria-label="Guardar"/);
    assert.doesNotMatch(detailHtml, />Guardar participantes</);
    assert.match(detailHtml, /test-admin@example.com/);
    const unassigned = await send({ type: "task.clients.update", id: taskId, clientIds: [] });
    assert.deepEqual(unassigned.workspace.tasks.find((t) => t.id === taskId).clientIds, []);
    const assigned = await send({ type: "task.clients.update", id: taskId, clientIds: [clientId] });
    assert.deepEqual(assigned.workspace.tasks.find((t) => t.id === taskId).clientIds, [clientId]);
    assert.equal(assigned.workspace.tasks.find((t) => t.id === taskId).title, fields.title);
    await send({ type: "task.clients.update", id: taskId }, 400);
    await send({ type: "task.clients.update", id: taskId, clientIds: ["unknown"] }, 400);
    await send({ type: "task.archive", id: taskId, archived: true });
    await send({ type: "client.delete", id: clientId }, 409);
    const edited = await send({ type: "client.update", id: clientId, name: "Cliente editado HTTP", cityId: "11001" });
    assert.equal(edited.workspace.clients.find((client) => client.id === clientId).departmentId, "11");
    const backup = await (await fetch(base + "/api/backup")).json();
    assert.equal(backup.version, 4);
    assert.ok(backup.tables.task_clients.some((link) => link.clientId === clientId && link.taskId === taskId));
    await send({ type: "task.clients.update", id: taskId, clientIds: [] });
  } finally {
    if (projectId) await send({ type: "project.delete", id: projectId });
    await send({ type: "client.delete", id: clientId });
  }
});

test("HTTP: proyectos y API requieren sesión; landing, healthcheck y login son públicos", async () => {
  for (const path of [
    "/api/workspace",
    "/api/geography",
    "/api/backup",
    "/api/backups",
    "/api/invitations",
    "/api/users",
  ]) {
    const r = await globalThis.fetch(base + path);
    assert.equal(r.status, 401, path);
  }
  const home = await globalThis.fetch(base, { redirect: "manual" });
  assert.equal(home.status, 200);
  const projects = await globalThis.fetch(base + "/projects", { redirect: "manual" });
  assert.equal(projects.status, 307);
  assert.equal(new URL(projects.headers.get("location"), base).pathname, "/login");
  const clients = await globalThis.fetch(base + "/clients", { redirect: "manual" });
  assert.equal(clients.status, 307);
  assert.equal(new URL(clients.headers.get("location"), base).pathname, "/login");
  const login = await globalThis.fetch(base + "/login");
  assert.equal(login.status, 200);
  const html = await login.text();
  assert.match(html, /Continuar con Google/);
  assert.match(html, /Continuar con GitHub/);
  assert.match(html, /Vuelve a tu proyecto/);
  const signedInLogin = await fetch(base + "/login", { redirect: "manual" });
  assert.equal(signedInLogin.status, 307);
  assert.equal(signedInLogin.headers.get("location"), "/projects");
  assert.equal((await globalThis.fetch(base + "/api/health")).status, 200);
});

test("HTTP: archivos mayores de 4,5 MB, documentos privados, comentarios y configuración", async () => {
  let projectId;
  try {
    const created = await send({type:"project.create", name:"Archivos HTTP", description:"", icon:"A", color:"#059669"});
    projectId = created.createdId;
    const fields = {projectId, featureId:created.workspace.features.find(f=>f.projectId===projectId).id, statusId:created.workspace.statuses.find(s=>s.projectId===projectId).id, title:"Documentos", description:"", priority:"medium", dueDate:null, labels:[]};
    const taskId = (await send({type:"task.create",...fields})).createdId;
    const bytes = Buffer.alloc(5*1024*1024); bytes.write("%PDF-1.7\n");
    const initiate = await fetch(base+"/api/files/uploads",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({projectId,taskId,name:"informe.pdf",size:bytes.length,purpose:"document"})});
    assert.equal(initiate.status,200); const upload=await initiate.json(); assert.equal(upload.url,null);
    const put = await fetch(base+`/api/files/uploads/${upload.id}`,{method:"PUT",headers:{"Content-Type":"application/pdf"},body:bytes}); assert.equal(put.status,200);
    const complete = await fetch(base+`/api/files/uploads/${upload.id}/complete`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({taskId})}); assert.equal(complete.status,200);
    const content=await fetch(base+`/api/files/${upload.id}/content`); assert.equal(content.status,200); assert.equal((await content.arrayBuffer()).byteLength,bytes.length); assert.match(content.headers.get("cache-control"),/no-store/);
    assert.equal((await globalThis.fetch(base+`/api/files/${upload.id}/content`)).status,401);
    const people=await fetch(base+`/api/projects/${projectId}/people`); assert.equal(people.status,200); assert.ok((await people.json()).people.length);
    await send({type:"comment.create",taskId,content:"Mensaje HTTP"});
    const notes=await fetch(base+`/api/tasks/${taskId}/comments`); assert.equal(notes.status,200); assert.equal((await notes.json()).comments[0].author.id,"test-admin");
    assert.equal((await fetch(base+`/api/files/${upload.id}`,{method:"DELETE"})).status,200);
    assert.equal((await fetch(base+`/api/files/${upload.id}/content`)).status,404);
    await send({type:"settings.update",maxAttachmentBytes:1048576});
    const tooLarge=await fetch(base+"/api/files/uploads",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({projectId,name:"large.pdf",size:bytes.length,purpose:"document"})}); assert.equal(tooLarge.status,413);
  } finally {
    await send({type:"settings.update",maxAttachmentBytes:10485760});
    if(projectId) await send({type:"project.delete",id:projectId});
  }
});

test("HTTP: API de chat acotada, idempotencia, origen, tamaño y aislamiento por tarea", async () => {
  let projectId;
  try {
    const project = await send({ type: "project.create", name: "Chat HTTP", description: "", icon: "C", color: "#059669" });
    projectId = project.createdId;
    const fields = { type: "task.create", projectId, featureId: project.workspace.features.find((f) => f.projectId === projectId).id, statusId: project.workspace.statuses.find((s) => s.projectId === projectId).id, title: "Conversación", description: "", priority: "medium", dueDate: null };
    const taskId = (await send(fields)).createdId, otherTaskId = (await send(fields)).createdId;
    const path = `${base}/api/tasks/${taskId}/comments`;
    const post = async (body, expected = 200, endpoint = path) => {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json(); assert.equal(response.status, expected, JSON.stringify(data)); return data;
    };
    const command = { type: "comment.create", taskId, content: "Mensaje dedicado", requestId: randomUUID() };
    const created = await post(command);
    assert.equal(created.createdId, command.requestId);
    assert.equal(created.workspace, undefined);
    assert.equal(created.comments[0].content, command.content);
    assert.deepEqual(created.realtime, { enabled: false, channel: null });
    assert.equal((await post(command)).comments.length, 1);
    const edited = await post({ type: "comment.update", id: created.createdId, content: "Editado dedicado" });
    assert.equal(edited.comments[0].content, "Editado dedicado");
    await post({ type: "comment.delete", id: created.createdId }, 404, `${base}/api/tasks/${otherTaskId}/comments`);
    await post({ type: "task.delete", id: taskId }, 400);
    await post({ type: "comment.create", taskId, content: "x".repeat(70_000) }, 413);
    assert.equal((await globalThis.fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(command) })).status, 401);
    assert.equal((await fetch(path, { method: "POST", headers: { Origin: "https://attacker.example" }, body: JSON.stringify(command) })).status, 403);
    assert.equal((await fetch(path, { method: "POST", body: "{" })).status, 400);
    assert.equal((await fetch(`${path}/token`, { method: "POST" })).status, 503);
    assert.equal((await post({ type: "comment.delete", id: created.createdId })).comments.length, 0);
  } finally { if (projectId) await send({ type: "project.delete", id: projectId }); }
});

test("HTTP: líder y equipo usan el contrato nuevo y aceptan solicitudes anteriores", async () => {
  const member = await addUser(fixture.repo, `team-${randomUUID()}`);
  let projectId;
  try {
    const project = await send({ type: "project.create", name: "Líder y equipo", description: "", icon: "👥", color: "#059669" });
    projectId = project.createdId;
    await send({ type: "project.member.add", projectId, userId: member.id });
    const created = await send({
      type: "task.create", projectId,
      featureId: project.workspace.features.find((feature) => feature.projectId === projectId).id,
      statusId: project.workspace.statuses.find((status) => status.projectId === projectId).id,
      title: "Asignaciones", description: "Conservar", priority: "medium", dueDate: null,
      leaderId: "test-admin", teamMemberIds: [member.id, member.id],
    });
    const taskId = created.createdId;
    assert.deepEqual(created.workspace.tasks.find((task) => task.id === taskId).teamMemberIds, [member.id]);
    const changed = await send({ type: "task.assignment.update", id: taskId, leaderId: member.id, teamMemberIds: ["test-admin"] });
    const task = changed.workspace.tasks.find((task) => task.id === taskId);
    assert.equal(task.leaderId, member.id);
    assert.equal(task.leader.id, member.id);
    assert.deepEqual(task.teamMemberIds, ["test-admin"]);
    assert.equal(task.teamMembers[0].id, "test-admin");
    assert.equal(task.assigneeId, undefined);
    assert.equal(task.collaboratorIds, undefined);
    const legacy = await send({ type: "task.participants.update", id: taskId, assigneeId: "test-admin", collaboratorIds: [member.id] });
    const normalized = legacy.workspace.tasks.find((task) => task.id === taskId);
    assert.equal(normalized.leaderId, "test-admin");
    assert.deepEqual(normalized.teamMemberIds, [member.id]);
    assert.equal(normalized.description, "Conservar");
  } finally {
    if (projectId) await send({ type: "project.delete", id: projectId });
  }
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
