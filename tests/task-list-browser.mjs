import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { startHttpFixture } from "./http-fixture.ts";
import { actor } from "./helpers.ts";

let f, projectId, featureId;
before(async () => {
  f = await startHttpFixture();
  projectId = (await f.repo.execute({ type: "project.create", name: "Lista QA", description: "", icon: "L", color: "#3b82f6" }, actor)).createdId;
  featureId = (await f.repo.execute({ type: "feature.create", projectId, moduleId: null, name: "Feature lista QA", description: "" }, actor)).createdId;
  const w = await f.repo.getWorkspace(actor);
  const statuses = w.statuses.filter((s) => s.projectId === projectId);
  const type = w.taskTypes.find((t) => t.projectId === projectId);
  const impact = w.impacts.find((t) => t.projectId === projectId);
  await f.repo.execute({ type: "task.create", projectId, featureId, statusId: statuses[0].id, priority: "high", title: "Tarea completa con todos los campos", description: "", typeId: type?.id ?? null, impactId: impact?.id ?? null, dueDate: "2020-01-10", dueTime: "16:00", startDate: "2020-01-05", labels: [] }, actor);
  await f.repo.execute({ type: "task.create", projectId, featureId, statusId: statuses[0].id, priority: "medium", title: "Tarea mínima sin tipo, impacto ni fecha", description: "", dueDate: null, labels: [] }, actor);
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

test("navegador lista de tareas: filas compactas, sin campos vacíos y sin encabezado en la feature", { timeout: 90_000 }, async () => {
  const { browser, page, errors } = await browserPage({ width: 1440, height: 900 });
  try {
    await page.goto(`${f.base}/projects/${projectId}?view=list`);
    const rows = page.locator("ul[aria-label^='Tareas de'] > li");
    await rows.first().waitFor();
    assert.equal(await rows.count(), 2);
    for (const text of ["Sin tipo", "Sin impacto", "Sin fecha"]) assert.equal(await page.locator("ul[aria-label^='Tareas de']").getByText(text, { exact: true }).count(), 0, text);
    assert.ok(await page.getByRole("heading", { name: "Feature lista QA" }).isVisible(), "el encabezado del grupo se mantiene en la lista general");
    const heights = await rows.evaluateAll((items) => items.map((item) => item.getBoundingClientRect().height));
    assert.ok(heights.every((h) => h < 100), `filas compactas: ${heights}`);
    assert.ok(await rows.first().getByText("Vencida").count() === 1, "la fecha vencida se destaca");
    await page.screenshot({ path: "test-results/task-list-workspace.png", fullPage: true });

    await page.goto(`${f.base}/projects/${projectId}/features/${featureId}?tab=tasks`);
    await rows.first().waitFor();
    assert.equal(await page.getByRole("heading", { name: "Feature lista QA", level: 2 }).count(), 0, "sin encabezado de grupo redundante en el tab");
    assert.equal(await rows.count(), 2);
    await page.screenshot({ path: "test-results/task-list-feature.png", fullPage: true });

    await page.setViewportSize({ width: 390, height: 800 });
    await page.reload();
    await rows.first().waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "sin desbordamiento horizontal en móvil");
    await page.screenshot({ path: "test-results/task-list-mobile.png", fullPage: true });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
