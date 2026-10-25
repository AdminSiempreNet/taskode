import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { startHttpFixture } from "./http-fixture.ts";
import { actor } from "./helpers.ts";

let f, projectId;
before(async () => {
  f = await startHttpFixture();
  projectId = (await f.repo.execute({ type: "project.create", name: "Sidebar QA", description: "", icon: "S", color: "#3b82f6" }, actor)).createdId;
  const busy = (await f.repo.execute({ type: "module.create", projectId, name: "Con tareas", description: "" }, actor)).createdId;
  const idle = (await f.repo.execute({ type: "module.create", projectId, name: "Vacío", description: "" }, actor)).createdId;
  const featureId = (await f.repo.execute({ type: "feature.create", projectId, moduleId: busy, name: "Feature activa", description: "" }, actor)).createdId;
  await f.repo.execute({ type: "feature.create", projectId, moduleId: busy, name: "Feature sin tareas", description: "" }, actor);
  await f.repo.execute({ type: "feature.create", projectId, moduleId: idle, name: "Feature dormida", description: "" }, actor);
  await f.repo.execute({ type: "feature.create", projectId, moduleId: null, name: "Feature general", description: "" }, actor);
  const w = await f.repo.getWorkspace(actor);
  const status = w.statuses.find((s) => s.projectId === projectId);
  await f.repo.execute({ type: "task.create", projectId, featureId, statusId: status.id, priority: "medium", title: "Tarea del sidebar", description: "", dueDate: null, labels: [] }, actor);
  await mkdir("test-results", { recursive: true });
});
after(async () => { await f?.stop(); });

async function browserPage(viewport) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport });
  const split = f.cookie.indexOf("=");
  await context.addCookies([{ name: f.cookie.slice(0, split), value: f.cookie.slice(split + 1), url: f.base }]);
  const page = await context.newPage(), errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(15_000);
  return { browser, page, errors };
}

const moduleNames = (page) =>
  page.locator(".feature-module").evaluateAll((items) => items.map((item) => item.getAttribute("aria-label")));
const expandedStates = (page) =>
  page.locator(".module-toggle").evaluateAll((items) => items.map((item) => item.getAttribute("aria-expanded")));

test("navegador sidebar: expandir y contraer todo, y solo módulos y features con tareas", { timeout: 90_000 }, async () => {
  const { browser, page, errors } = await browserPage({ width: 1440, height: 900 });
  try {
    await page.goto(`${f.base}/projects/${projectId}`);
    const expandAll = page.getByRole("button", { name: "Expandir todos los módulos" });
    await expandAll.waitFor();
    assert.deepEqual(await moduleNames(page), ["Módulo General", "Módulo Con tareas", "Módulo Vacío"]);
    assert.deepEqual(await expandedStates(page), ["false", "false", "false"]);

    await expandAll.click();
    assert.deepEqual(await expandedStates(page), ["true", "true", "true"]);
    const collapseAll = page.getByRole("button", { name: "Contraer todos los módulos" });
    assert.equal(await page.getByRole("button", { name: "Ver feature: Feature dormida" }).isVisible(), true);
    await page.screenshot({ path: "test-results/sidebar-expanded.png" });
    await collapseAll.click();
    assert.deepEqual(await expandedStates(page), ["false", "false", "false"]);

    // Expanding one module by hand still leaves "expand all" available.
    await page.getByRole("button", { name: "Expandir módulo Vacío" }).click();
    await expandAll.waitFor();

    const tasksOnly = page.getByRole("button", { name: "Mostrar solo módulos y features con tareas" });
    assert.equal(await tasksOnly.getAttribute("aria-pressed"), "false");
    await tasksOnly.click();
    assert.equal(await tasksOnly.getAttribute("aria-pressed"), "true");
    assert.deepEqual(await moduleNames(page), ["Módulo Con tareas"]);
    await expandAll.click();
    assert.equal(await page.getByRole("button", { name: "Ver feature: Feature activa" }).isVisible(), true);
    assert.equal(await page.getByRole("button", { name: "Ver feature: Feature sin tareas" }).count(), 0);
    assert.equal(await page.locator(".module-toggle small").textContent(), "1");
    await page.screenshot({ path: "test-results/sidebar-tasks-only.png" });

    await page.reload();
    await page.getByRole("button", { name: "Mostrar solo módulos y features con tareas", pressed: true }).waitFor();
    assert.deepEqual(await moduleNames(page), ["Módulo Con tareas"]);
    assert.deepEqual(await expandedStates(page), ["true"], "la expansión se conserva al recargar");

    await page.getByLabel("Buscar módulos y features por nombre o descripción").fill("dormida");
    await page.getByText("No se encontraron módulos ni features con tareas.").waitFor();
    assert.equal(await page.getByRole("button", { name: "Expandir todos los módulos" }).isDisabled(), true);
    await page.getByRole("button", { name: "Limpiar búsqueda de módulos y features" }).click();
    await tasksOnly.click();
    assert.deepEqual(await moduleNames(page), ["Módulo General", "Módulo Con tareas", "Módulo Vacío"]);

    const toolbar = await page.locator(".feature-toolbar").evaluate((node) => ({
      overflow: node.scrollWidth > node.clientWidth,
      search: node.querySelector(".feature-search").getBoundingClientRect().width,
    }));
    assert.equal(toolbar.overflow, false);
    assert.ok(toolbar.search > 120, `búsqueda usable: ${toolbar.search}`);

    await page.setViewportSize({ width: 390, height: 800 });
    await page.reload();
    await page.getByRole("button", { name: "Abrir barra lateral" }).click();
    await page.getByRole("button", { name: "Expandir todos los módulos" }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "sin desbordamiento horizontal en móvil");
    await page.screenshot({ path: "test-results/sidebar-mobile.png" });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
