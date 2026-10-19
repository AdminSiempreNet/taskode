import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { startHttpFixture } from "./http-fixture.ts";
import { actor } from "./helpers.ts";
import { DocumentsService } from "../src/server/documents.ts";

let f, projectId, moduleId, featureId, taskId, clientId, ticketId, mentionTicketId;
before(async () => {
  f = await startHttpFixture();
  projectId = (await f.repo.execute({ type: "project.create", name: "Relaciones QA", description: "Contexto", icon: "R", color: "#059669" }, actor)).createdId;
  moduleId = (await f.repo.execute({ type: "module.create", projectId, name: "Módulo QA", description: "Contexto" }, actor)).createdId;
  featureId = (await f.repo.execute({ type: "feature.create", projectId, moduleId, name: "Feature QA", description: "Contexto" }, actor)).createdId;
  const workspace = await f.repo.getWorkspace(actor);
  taskId = (await f.repo.execute({ type: "task.create", projectId, featureId, statusId: workspace.statuses[0].id, priority: "medium", title: "Tarea QA", description: "Contexto", dueDate: null, labels: [] }, actor)).createdId;
  clientId = (await f.repo.execute({ type: "client.create", name: "Cliente tickets QA", cityId: "05001" }, actor)).createdId;
  ticketId = (await f.repo.execute({ type: "ticket.create", number: "00042", description: "Ticket principal QA", url: "https://example.com/00042", clientId }, actor)).createdId;
  await f.repo.execute({ type: "ticket.create", number: "00042", description: "Duplicado QA", url: null, clientId }, actor);
  mentionTicketId = (await f.repo.execute({ type: "ticket.create", number: "M-001", description: "Referencia sin asignar", url: "https://example.com/M-001", clientId }, actor)).createdId;
  await mkdir("test-results", { recursive: true });
});
after(async () => { await f?.stop(); });

const scopes = () => [{ kind: "project", id: projectId, projectId }, { kind: "module", id: moduleId, projectId }, { kind: "feature", id: featureId, projectId }, { kind: "task", id: taskId, projectId }];
const paths = () => [`/projects/${projectId}/details`, `/projects/${projectId}/modules/${moduleId}`, `/projects/${projectId}/features/${featureId}`, `/projects/${projectId}/tasks/${taskId}`];
async function openBrowser(viewport = { width: 1440, height: 1000 }, theme = "light") {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport });
  const split = f.cookie.indexOf("=");
  await context.addCookies([{ name: f.cookie.slice(0, split), value: f.cookie.slice(split + 1), url: f.base }]);
  await context.addInitScript((value) => localStorage.setItem("theme", value), theme);
  const page = await context.newPage(), errors = [];
  page.on("pageerror", (error) => errors.push(error.message)); page.setDefaultTimeout(10_000);
  return { browser, page, errors };
}
async function mutation(page, action, type) {
  const [response] = await Promise.all([page.waitForResponse((response) => new URL(response.url()).pathname === "/api/workspace" && response.request().method() === "POST" && (!type || JSON.parse(response.request().postData()).type === type)), action()]);
  assert.equal(response.status(), 200, await response.text());
  return response.json();
}

test("Tickets tolera una respuesta anterior de la API y recupera el catálogo actual", async () => {
  const { browser, page, errors } = await openBrowser();
  try {
    await page.route("**/api/workspace*", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      const response = await route.fetch(), snapshot = await response.json();
      delete snapshot.tickets; delete snapshot.clients;
      for (const kind of ["projects", "modules", "features", "tasks"])
        for (const entity of snapshot[kind]) { delete entity.clientIds; delete entity.ticketIds; }
      await route.fulfill({ response, json: snapshot });
    });
    await page.goto(f.base + "/tickets");
    await page.getByRole("cell", { name: "Ticket principal QA", exact: true }).waitFor();
    assert.deepEqual(errors, []);
    await page.unroute("**/api/workspace*");
    await page.reload();
    await page.getByRole("cell", { name: "Ticket principal QA", exact: true }).waitFor();
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test("HTTP tickets: sesión, origen, campo antiguo y destinos inválidos", async () => {
  const send = (body, headers = {}) => fetch(f.base + "/api/workspace", { method: "POST", headers: { Cookie: f.cookie, "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  const payload = { type: "ticket.create", number: "HTTP-1", description: "", url: null, clientId: null };
  assert.equal((await send(payload, { Cookie: "" })).status, 401);
  assert.equal((await send(payload, { Origin: "https://other.invalid" })).status, 403);
  assert.equal((await send({ ...payload, url: "javascript:alert(1)" })).status, 400);
  const old = await send({ type: "task.update", id: taskId, ticketNumber: "old" });
  assert.equal(old.status, 409); assert.match((await old.json()).error, /Recarga/);
  assert.equal((await send({ type: "entity.tickets.update", scope: { ...scopes()[0], projectId: "wrong" }, ticketIds: [ticketId] })).status, 404);
  assert.equal((await send({ ...payload, scope: { kind: "module", id: "general", projectId } })).status, 404);
});

test("pestañas en cuatro niveles: asignación, duplicados, cliente automático y edición global", { timeout: 120_000 }, async () => {
  const { browser, page, errors } = await openBrowser();
  try {
    for (const [index, path] of paths().entries()) {
      await page.goto(`${f.base}${path}?tab=tickets`);
      await page.getByRole("tabpanel", { name: "Tickets" }).waitFor();
      assert.equal(await page.locator('input[name="ticketNumber"]').count(), 0);
      await page.getByRole("combobox", { name: "Tickets", exact: true }).click();
      await page.getByRole("combobox", { name: "Buscar tickets", exact: true }).fill("00042");
      assert.equal(await page.getByRole("option").count(), 2);
      await mutation(page, () => page.getByRole("option", { name: /Ticket principal QA/ }).click(), "entity.tickets.update");
      await page.keyboard.press("Escape");
      await page.getByRole("list", { name: "Tickets asignados" }).getByText("Ticket principal QA").waitFor();
      const entity = (await f.repo.entityDetail(actor, scopes()[index].kind, scopes()[index].id)).entity;
      assert.deepEqual(entity.ticketIds, [ticketId]); assert.deepEqual(entity.clientIds, [clientId]);
      await page.getByRole("tab", { name: /^Clientes/ }).click();
      await page.getByRole("list", { name: "Clientes asignados" }).getByText("Cliente tickets QA").waitFor();
      assert.equal(new URL(page.url()).searchParams.get("tab"), "clients");
    }
    await page.goto(`${f.base}/tickets`);
    await page.getByRole("heading", { name: "Tickets", exact: true }).waitFor();
    await Promise.all([
      page.waitForResponse((response) => new URL(response.url()).pathname === "/api/tickets" && new URL(response.url()).searchParams.get("q") === "Ticket principal QA"),
      page.getByRole("textbox", { name: "Buscar tickets" }).fill("Ticket principal QA"),
    ]);
    await page.waitForFunction(() => document.querySelectorAll(".tickets-table tbody tr").length === 1);
    await page.getByRole("button", { name: "Editar ticket 00042", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox", { name: "Descripción", exact: true }).fill("Editado desde catálogo");
    await mutation(page, () => dialog.getByRole("button", { name: "Guardar cambios", exact: true }).click(), "ticket.update");
    await page.getByRole("textbox", { name: "Buscar tickets" }).fill("Editado desde catálogo");
    await page.getByRole("cell", { name: "Editado desde catálogo", exact: true }).waitFor();
    await page.screenshot({ path: "test-results/tickets-catalog.png" });
    await page.getByRole("button", { name: "Eliminar ticket 00042", exact: true }).click();
    const alert = page.getByRole("alertdialog");
    const [response] = await Promise.all([page.waitForResponse((response) => new URL(response.url()).pathname === "/api/workspace" && response.request().postData()?.includes("ticket.delete")), alert.getByRole("button", { name: "Eliminar", exact: true }).click()]);
    assert.equal(response.status(), 409);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test("creación de tarea: pestañas conservan borrador y ticket nuevo con cliente", { timeout: 120_000 }, async () => {
  const { browser, page, errors } = await openBrowser();
  try {
    await page.goto(`${f.base}/projects/${projectId}/tasks/new`);
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox", { name: "Título", exact: true }).fill("Tarea con tickets desde borrador");
    await dialog.getByRole("tab", { name: /^Tickets/ }).click();
    await dialog.getByRole("combobox", { name: "Tickets", exact: true }).click();
    await page.getByRole("combobox", { name: "Buscar tickets", exact: true }).fill("NUEVO-0001");
    await page.getByRole("button", { name: /Crear ticket/ }).click();
    const ticketDialog = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Nuevo ticket", exact: true }) });
    assert.equal(await ticketDialog.getByRole("textbox", { name: "Número del ticket" }).inputValue(), "NUEVO-0001");
    await ticketDialog.getByRole("textbox", { name: "Descripción", exact: true }).fill("Creado en el borrador");
    await ticketDialog.getByRole("combobox", { name: "Cliente del ticket", exact: true }).click();
    await page.getByRole("combobox", { name: "Buscar cliente del ticket", exact: true }).fill("Cliente desde ticket");
    await page.getByRole("button", { name: /Crear cliente/ }).click();
    const clientDialog = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Nuevo cliente", exact: true }) });
    await clientDialog.getByRole("combobox", { name: "Ciudades", exact: true }).click();
    await page.getByRole("combobox", { name: "Buscar ciudades", exact: true }).fill("MEDELLÍN");
    await page.getByRole("option", { name: /MEDELLÍN/ }).click();
    const clientData = await mutation(page, () => clientDialog.getByRole("button", { name: "Crear cliente", exact: true }).click(), "client.create");
    await ticketDialog.getByRole("combobox", { name: "Cliente del ticket", exact: true }).getByText("Cliente desde ticket", { exact: true }).waitFor();
    await mutation(page, () => ticketDialog.getByRole("button", { name: "Crear ticket", exact: true }).click(), "ticket.create");
    await dialog.getByRole("list", { name: "Tickets asignados" }).getByText("NUEVO-0001", { exact: true }).waitFor();
    await dialog.getByRole("tab", { name: /^Clientes/ }).click();
    await dialog.getByRole("list", { name: "Clientes asignados" }).getByText("Cliente desde ticket").waitFor();
    await dialog.getByRole("tab", { name: "Detalles", exact: true }).click();
    assert.equal(await dialog.getByRole("textbox", { name: "Título", exact: true }).inputValue(), "Tarea con tickets desde borrador");
    await dialog.getByRole("tab", { name: /^Tickets/ }).click();
    // Deleting an unassigned catalog record must also remove its draft selection.
    await dialog.getByRole("combobox", { name: "Tickets", exact: true }).click();
    await page.getByRole("combobox", { name: "Buscar tickets", exact: true }).fill("BORRAR-BORRADOR");
    await page.getByRole("button", { name: /Crear ticket/ }).click();
    const temporary = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Nuevo ticket", exact: true }) });
    await mutation(page, () => temporary.getByRole("button", { name: "Crear ticket", exact: true }).click(), "ticket.create");
    await dialog.getByRole("button", { name: "Eliminar ticket BORRAR-BORRADOR del catálogo", exact: true }).click();
    await mutation(page, () => page.getByRole("alertdialog").getByRole("button", { name: "Eliminar", exact: true }).click(), "ticket.delete");
    await dialog.getByRole("list", { name: "Tickets asignados" }).getByText("BORRAR-BORRADOR", { exact: true }).waitFor({ state: "hidden" });
    const data = await mutation(page, () => dialog.getByRole("button", { name: "Crear y editar", exact: true }).click(), "task.create");
    await page.waitForURL((url) => url.pathname.endsWith(data.createdId));
    const task = data.workspace.tasks.find((task) => task.id === data.createdId);
    assert.equal(task.title, "Tarea con tickets desde borrador"); assert.equal(task.ticketIds.length, 1); assert.deepEqual(task.clientIds, [clientData.createdId]);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test("!tickets en comentarios, descripciones y documentos de los cuatro niveles", { timeout: 180_000 }, async () => {
  const { browser, page, errors } = await openBrowser();
  const choose = async (editor) => {
    await editor.click(); await editor.press("End"); await editor.pressSequentially(" !M-001");
    await page.getByRole("option", { name: /M-001.*Cliente tickets QA/ }).click();
    assert.equal(await editor.locator(".mention-ticket").count(), 1);
  };
  try {
    for (const [index, path] of paths().entries()) {
      await page.goto(f.base + path);
      const composer = page.getByRole("textbox", { name: "Escribir comentario", exact: true });
      await choose(composer); await composer.press("Enter");
      const mention = page.getByRole("log").locator(".mention-ticket").last(); await mention.waitFor(); await mention.hover();
      await page.locator(".mention-card").getByRole("link", { name: "Abrir ticket" }).waitFor();
      await page.mouse.move(0, 0);
      await page.getByRole("region", { name: "Editar descripción", exact: true }).click();
      await choose(page.locator(".description-writing"));
      await mutation(page, () => page.getByRole("button", { name: "Guardar", exact: true }).click());
      await page.reload();
      await page.getByRole("region", { name: "Editar descripción", exact: true }).locator(".mention-ticket").waitFor();
      const scope = scopes()[index];
      const doc = await new DocumentsService(f.repo).create(actor, scope.kind, scope.id, { title: "Mención de ticket", description: "", content: "" });
      await page.goto(`${f.base}${path}?tab=documents&document=${doc.id}`);
      await page.getByRole("region", { name: "Editar contenido del documento" }).click();
      await choose(page.getByRole("textbox", { name: "Contenido del documento" }));
      const [saved] = await Promise.all([
        page.waitForResponse((response) => response.url().endsWith(`/api/documents/${doc.id}`) && response.request().method() === "PUT"),
        page.getByRole("tabpanel", { name: "Documentos" }).getByRole("button", { name: "Guardar", exact: true }).click(),
      ]);
      assert.equal(saved.status(), 200, await saved.text());
      await page.reload();
      await page.getByRole("tabpanel", { name: "Documentos" }).locator(".description-rendered .mention-ticket").waitFor();
      assert.match((await new DocumentsService(f.repo).get(actor, doc.id)).content, new RegExp(`/mentions/tickets/${mentionTicketId}`));
      assert.ok(!(await f.repo.entityDetail(actor, scope.kind, scope.id)).entity.ticketIds.includes(mentionTicketId));
    }
    assert.equal((await f.repo.notifications.list(actor)).items.length, 0);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test("móvil oscuro: pestañas, ficha y creación desde una entidad guardada", { timeout: 90_000 }, async () => {
  const { browser, page, errors } = await openBrowser({ width: 390, height: 844 }, "dark");
  try {
    await page.goto(`${f.base}${paths()[1]}?tab=tickets`);
    await page.getByRole("combobox", { name: "Tickets", exact: true }).click();
    await page.getByRole("combobox", { name: "Buscar tickets", exact: true }).fill("MOVIL-001");
    await page.getByRole("button", { name: /Crear ticket/ }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox", { name: "Descripción", exact: true }).fill("Ticket desde móvil");
    await mutation(page, () => dialog.getByRole("button", { name: "Crear ticket", exact: true }).click(), "ticket.create");
    await page.getByRole("list", { name: "Tickets asignados" }).getByText("MOVIL-001", { exact: true }).waitFor();
    assert.ok((await f.repo.entityDetail(actor, "module", moduleId)).entity.ticketIds.length >= 2);
    await page.screenshot({ path: "test-results/tickets-mobile-dark.png" });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test("edición del catálogo refresca menciones activas y la búsqueda usa todos los tickets directos", { timeout: 90_000 }, async () => {
  const { browser, page, errors } = await openBrowser();
  try {
    await page.goto(f.base + paths()[0]);
    // The mounted description keeps the options cache alive while editing in another tab.
    await page.getByRole("region", { name: "Editar descripción", exact: true }).locator(".mention-ticket").waitFor();
    await page.getByRole("tab", { name: /^Tickets/ }).click();
    await page.getByRole("button", { name: "Editar ticket 00042", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox", { name: "Número del ticket", exact: true }).fill("ACTUALIZADO-42");
    await mutation(page, () => dialog.getByRole("button", { name: "Guardar cambios", exact: true }).click(), "ticket.update");
    await page.getByRole("tab", { name: "Descripción", exact: true }).click();
    await page.getByRole("region", { name: "Editar descripción", exact: true }).click();
    const editor = page.locator(".description-writing");
    await editor.press("End"); await editor.pressSequentially(" !ACTUALIZADO");
    await page.getByRole("option", { name: /ACTUALIZADO-42/ }).click();
    assert.equal(await editor.locator(".mention-ticket").count(), 2);
    await mutation(page, () => page.getByRole("button", { name: "Guardar", exact: true }).click());
    await f.repo.execute({ type: "entity.tickets.update", scope: scopes()[3], ticketIds: [ticketId, mentionTicketId] }, actor);
    await f.repo.execute({ type: "ticket.create", number: "SOLO-PROYECTO", description: "", url: null, clientId: null, scope: scopes()[0] }, actor);
    await page.goto(`${f.base}/projects/${projectId}?view=list`);
    const search = page.getByRole("textbox", { name: "Buscar tareas", exact: true });
    for (const number of ["ACTUALIZADO-42", "M-001"]) {
      await search.fill(number); await page.getByText("Tarea QA", { exact: true }).waitFor();
    }
    await search.fill("SOLO-PROYECTO"); await page.getByText("Tarea QA", { exact: true }).waitFor({ state: "hidden" });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test("desvincular conserva clientes y permite el borrado global con menciones históricas", { timeout: 90_000 }, async () => {
  const { browser, page, errors } = await openBrowser();
  try {
    for (const [index, path] of paths().entries()) {
      await page.goto(`${f.base}${path}?tab=tickets`);
      await mutation(page, () => page.getByRole("button", { name: "Quitar ticket ACTUALIZADO-42", exact: true }).click(), "entity.tickets.update");
      await page.getByRole("button", { name: "Quitar ticket ACTUALIZADO-42", exact: true }).waitFor({ state: "hidden" });
      const entity = (await f.repo.entityDetail(actor, scopes()[index].kind, scopes()[index].id)).entity;
      assert.ok(entity.clientIds.includes(clientId)); assert.ok(!entity.ticketIds.includes(ticketId));
    }
    await page.goto(f.base + "/tickets");
    await page.getByRole("textbox", { name: "Buscar tickets", exact: true }).fill("ACTUALIZADO-42");
    await page.getByRole("button", { name: "Eliminar ticket ACTUALIZADO-42", exact: true }).click();
    await mutation(page, () => page.getByRole("alertdialog").getByRole("button", { name: "Eliminar", exact: true }).click(), "ticket.delete");
    await page.getByText("No se encontraron tickets.", { exact: true }).waitFor();
    await page.goto(f.base + paths()[0]);
    const historical = page.getByRole("region", { name: "Editar descripción", exact: true }).getByText("ACTUALIZADO-42", { exact: true });
    await historical.waitFor(); assert.equal(await historical.getAttribute("tabindex"), null);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
