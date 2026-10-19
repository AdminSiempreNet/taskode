import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { startHttpFixture } from "./http-fixture.ts";
import { actor } from "./helpers.ts";

let f, projectId, moduleId, featureId, taskId, web, android;
before(async () => {
  f = await startHttpFixture();
  projectId = (await f.repo.execute({ type: "project.create", name: "Aplicaciones QA", description: "", icon: "A", color: "#3b82f6" }, actor)).createdId;
  moduleId = (await f.repo.execute({ type: "module.create", projectId, name: "Módulo QA", description: "" }, actor)).createdId;
  featureId = (await f.repo.execute({ type: "feature.create", projectId, moduleId, name: "Feature QA", description: "" }, actor)).createdId;
  const w = await f.repo.getWorkspace(actor);
  web = w.applications.find(a => a.isDefault); android = w.applications.find(a => a.name === "Android");
  taskId = (await f.repo.execute({ type: "task.create", projectId, featureId, statusId: w.statuses[0].id, priority: "medium", title: "Tarea Web QA", description: "", dueDate: null, labels: [] }, actor)).createdId;
  await f.repo.execute({ type: "task.create", projectId, featureId, statusId: w.statuses[0].id, priority: "medium", title: "Tarea vacía QA", description: "", dueDate: null, labels: [], applicationIds: [] }, actor);
  await mkdir("test-results", { recursive: true });
});
after(async () => { await f?.stop(); });

async function browserPage(viewport = { width: 1440, height: 1000 }) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport });
  const split = f.cookie.indexOf("=");
  await context.addCookies([{ name: f.cookie.slice(0, split), value: f.cookie.slice(split + 1), url: f.base }]);
  const page = await context.newPage(), errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.setDefaultTimeout(15_000);
  return { browser, page, errors };
}
async function mutation(page, action, type) {
  const [response] = await Promise.all([
    page.waitForResponse(r => new URL(r.url()).pathname === "/api/workspace" && r.request().method() === "POST" && JSON.parse(r.request().postData()).type === type), action(),
  ]);
  assert.equal(response.status(), 200, await response.text());
  return response.json();
}

test("navegador aplicaciones: asignación independiente en tres niveles y selección vacía", { timeout: 90_000 }, async () => {
  const { browser, page, errors } = await browserPage();
  try {
    for (const [kind, id] of [["module", moduleId], ["feature", featureId], ["task", taskId]]) {
      const plural = kind === "feature" ? "features" : `${kind}s`;
      await page.goto(`${f.base}/projects/${projectId}/${plural}/${id}?tab=properties`);
      await page.getByRole("combobox", { name: "Aplicaciones", exact: true }).click();
      await mutation(page, () => page.getByRole("option", { name: "Android", exact: true }).click(), "entity.applications.update");
      await page.keyboard.press("Escape");
      await page.reload();
      await page.getByRole("combobox", { name: "Aplicaciones", exact: true }).click();
      await page.getByRole("option", { name: "Android", exact: true, selected: true }).waitFor();
      await mutation(page, () => page.getByRole("button", { name: "Quitar todas las aplicaciones", exact: true }).click(), "entity.applications.update");
      await page.keyboard.press("Escape");
      assert.deepEqual(((await f.repo.entityDetail(actor, kind, id)).entity).applicationIds, []);
    }
    await page.screenshot({ path: "test-results/applications-detail.png", fullPage: true });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test("navegador aplicaciones: filtros persistentes y creación con selección vacía", { timeout: 90_000 }, async () => {
  const { browser, page, errors } = await browserPage();
  try {
    await page.goto(`${f.base}/projects/${projectId}?view=list`);
    const filter = page.getByRole("combobox", { name: "Clasificación", exact: true });
    await filter.click();
    await page.getByRole("option", { name: "Sin aplicación", exact: true }).click();
    await page.keyboard.press("Escape");
    await page.reload();
    await filter.click();
    await page.getByRole("option", { name: "Sin aplicación", exact: true, selected: true }).waitFor();
    await page.keyboard.press("Escape");
    await page.screenshot({ path: "test-results/applications-filters.png", fullPage: true });
    await page.goto(`${f.base}/projects/${projectId}?view=board`);
    await page.getByRole("button", { name: /Añadir tarea en/ }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox", { name: "Título", exact: true }).fill("Tarea creada sin aplicación");
    await dialog.getByRole("tab", { name: "Propiedades", exact: true }).click();
    await dialog.getByRole("combobox", { name: "Aplicaciones", exact: true }).click();
    await page.getByRole("option", { name: /Web/, selected: true }).waitFor();
    await page.getByRole("button", { name: "Quitar todas las aplicaciones", exact: true }).click();
    await page.keyboard.press("Escape");
    await mutation(page, () => dialog.getByRole("button", { name: "Crear", exact: true }).click(), "task.create");
    const task = (await f.repo.getWorkspace(actor)).tasks.find(t => t.title === "Tarea creada sin aplicación");
    assert.deepEqual(task.applicationIds, []);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test("navegador aplicaciones: configuración del catálogo y vista móvil", { timeout: 90_000 }, async () => {
  const { browser, page, errors } = await browserPage();
  try {
    await page.goto(`${f.base}/projects/${projectId}`);
    await page.getByRole("button", { name: "Menú de usuario", exact: true }).click();
    await page.getByRole("menuitem", { name: "Configuración", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Configuración general", exact: true });
    await dialog.getByRole("button", { name: "Aplicaciones", exact: true }).click();
    assert.equal(await dialog.getByRole("button", { name: "Eliminar Web", exact: true }).count(), 0);
    await dialog.getByRole("textbox", { name: "Nombre de nueva aplicación", exact: true }).fill("Linux QA");
    await mutation(page, () => dialog.getByRole("button", { name: "Añadir aplicación", exact: true }).click(), "application.create");
    await dialog.getByRole("textbox", { name: "Nombre de Linux QA", exact: true }).waitFor();
    await dialog.getByRole("textbox", { name: "Nombre de Web", exact: true }).fill("Navegador QA");
    await mutation(page, () => page.keyboard.press("Tab"), "application.update");
    await dialog.getByRole("textbox", { name: "Nombre de Navegador QA", exact: true }).waitFor();
    await page.screenshot({ path: "test-results/applications-settings.png", fullPage: true });
    const apps = (await f.repo.getWorkspace(actor)).applications;
    assert.equal(apps.find(a => a.id === web.id).isDefault, true);
    assert.equal(apps.some(a => a.name === "Linux QA"), true);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${f.base}/projects/${projectId}/tasks/${taskId}?tab=properties`);
    await page.getByRole("combobox", { name: "Aplicaciones", exact: true }).click();
    await page.getByRole("option", { name: /Navegador QA/ }).waitFor();
    await page.keyboard.press("Escape");
    await page.screenshot({ path: "test-results/applications-mobile.png", fullPage: true });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
