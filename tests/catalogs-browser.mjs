import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { startHttpFixture } from "./http-fixture.ts";
import { normalizeClientText } from "../src/lib/clients.ts";
import * as s from "../src/server/schema.ts";
import { actor } from "./helpers.ts";

let f, linkedScopes;
before(async () => {
  f = await startHttpFixture();
  const now = new Date().toISOString();
  await f.repo.store.db.insert(s.clients).values(Array.from({ length: 61 }, (_, i) => {
    const name = i === 60 ? "Zulu Café 060" : `Cliente ${String(i).padStart(3, "0")}`;
    return { id: `client-${i}`, name, normalizedName: normalizeClientText(name), cityId: "05001", createdAt: now, updatedAt: now };
  }));
  await f.repo.store.db.insert(s.tickets).values(Array.from({ length: 61 }, (_, i) => ({
    id: `ticket-${i}`, number: `T-${String(i).padStart(3, "0")}`, description: i === 60 ? "Último 100%_" : `Descripción ${i}`,
    clientId: i === 60 ? "client-60" : null, url: null, createdAt: now, updatedAt: now,
  })));
  const projectId = (await f.repo.execute({ type: "project.create", name: "Proyecto vínculos", description: "", icon: "P", color: "#059669" }, actor)).createdId;
  const moduleId = (await f.repo.execute({ type: "module.create", projectId, name: "Módulo vinculado", description: "" }, actor)).createdId;
  const featureId = (await f.repo.execute({ type: "feature.create", projectId, moduleId, name: "Feature vinculada", description: "" }, actor)).createdId;
  const statusId = (await f.repo.getWorkspace(actor)).statuses[0].id;
  const taskId = (await f.repo.execute({ type: "task.create", projectId, featureId, statusId, title: "Tarea vinculada", description: "", priority: "medium", dueDate: null, labels: [] }, actor)).createdId;
  linkedScopes = [{ kind: "project", id: projectId, projectId }, { kind: "module", id: moduleId, projectId }, { kind: "feature", id: featureId, projectId }, { kind: "task", id: taskId, projectId }];
  for (const scope of linkedScopes) await f.repo.execute({ type: "entity.tickets.update", scope, ticketIds: ["ticket-0"] }, actor);
  const modules = Array.from({ length: 30 }, (_, i) => ({ id: `linked-module-${i}`, projectId, leaderId: actor.id, name: `ZZ Módulo ${String(i).padStart(2, "0")}`, description: "", position: i + 2 }));
  await f.repo.store.db.insert(s.modules).values(modules);
  await f.repo.store.db.insert(s.moduleTickets).values(modules.map((module) => ({ moduleId: module.id, ticketId: "ticket-0" })));
  await mkdir("test-results", { recursive: true });
});
after(async () => { await f?.stop(); });

async function openBrowser(mobile = false) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 } });
  const split = f.cookie.indexOf("=");
  await context.addCookies([{ name: f.cookie.slice(0, split), value: f.cookie.slice(split + 1), url: f.base }]);
  if (mobile) await context.addInitScript(() => localStorage.setItem("theme", "dark"));
  const page = await context.newPage(), errors = [];
  page.on("pageerror", (error) => errors.push(error.message)); page.setDefaultTimeout(15_000);
  return { browser, page, errors };
}
const nav = (page, kind) => page.getByRole("navigation", { name: `Paginación de ${kind}`, exact: true });
async function showing(page, kind, range) {
  await nav(page, kind).getByText(`Mostrando ${range}`, { exact: true }).waitFor();
  await nav(page, kind).getByRole("combobox", { name: "Filas por página" }).waitFor({ state: "visible" });
  await page.waitForFunction(() => !document.querySelector('.clients-table-scroll[aria-busy="true"]'));
}
async function save(page, action, type) {
  const [response] = await Promise.all([
    page.waitForResponse((r) => new URL(r.url()).pathname === "/api/workspace" && r.request().method() === "POST" && JSON.parse(r.request().postData()).type === type), action(),
  ]);
  assert.equal(response.status(), 200, await response.text());
  const result = await response.json();
  assert.deepEqual(result.workspace.clients, []); assert.deepEqual(result.workspace.tickets, []);
  return result;
}

test("API catálogos: sesión, parámetros, límite, búsqueda y snapshots sin catálogos completos", async () => {
  for (const kind of ["clients", "tickets"]) {
    assert.equal((await fetch(`${f.base}/api/${kind}`)).status, 401);
    for (const params of ["page=0", "pageSize=1000", "page=-2", `q=${"a".repeat(201)}`])
      assert.equal((await fetch(`${f.base}/api/${kind}?${params}`, { headers: { Cookie: f.cookie } })).status, 400);
    const response = await fetch(`${f.base}/api/${kind}?page=3`, { headers: { Cookie: f.cookie } });
    assert.match(response.headers.get("cache-control"), /no-store/);
    const result = await response.json();
    assert.equal(result.items.length, 11); assert.equal(result.total, 61); assert.equal(result.page, 3);
  }
  const response = await fetch(`${f.base}/api/workspace?catalogs=none`, { headers: { Cookie: f.cookie } });
  const snapshot = await response.json();
  assert.deepEqual(snapshot.clients, []); assert.deepEqual(snapshot.tickets, []);
  for (const params of ["clientId=", "withoutClient=yes", "clientId=client-60&withoutClient=true"])
    assert.equal((await fetch(`${f.base}/api/tickets?${params}`, { headers: { Cookie: f.cookie } })).status, 400);
  const filtered = await fetch(`${f.base}/api/tickets?clientId=client-60`, { headers: { Cookie: f.cookie } });
  assert.equal((await filtered.json()).total, 1);
  const linksPath = `${f.base}/api/tickets/ticket-0/links/project`;
  assert.equal((await fetch(linksPath)).status, 401);
  assert.equal((await fetch(`${linksPath}?page=0`, { headers: { Cookie: f.cookie } })).status, 400);
  assert.equal((await fetch(`${f.base}/api/tickets/ticket-0/links/unknown`, { headers: { Cookie: f.cookie } })).status, 400);
  assert.equal((await fetch(`${f.base}/api/tickets/missing/links/task`, { headers: { Cookie: f.cookie } })).status, 404);
  const links = await fetch(linksPath, { headers: { Cookie: f.cookie } });
  assert.match(links.headers.get("cache-control"), /no-store/);
  assert.equal((await links.json()).total, 1);
});

test("ambos catálogos: navegación, tamaños y búsqueda fuera de la primera página", { timeout: 90_000 }, async () => {
  const { browser, page, errors } = await openBrowser();
  try {
    for (const [path, kind, search] of [["clients", "clientes", "CAFE"], ["tickets", "tickets", "ultimo 100%_"]]) {
      await page.goto(`${f.base}/${path}`);
      await showing(page, kind, "1–25 de 61");
      assert.equal(await page.locator(".clients-table tbody tr").count(), 25);
      assert.equal(await nav(page, kind).getByRole("button", { name: "Página anterior" }).isDisabled(), true);
      await nav(page, kind).getByRole("button", { name: "Página siguiente" }).click();
      await showing(page, kind, "26–50 de 61");
      await nav(page, kind).getByRole("button", { name: "Última página" }).click();
      await showing(page, kind, "51–61 de 61");
      assert.equal(await nav(page, kind).getByRole("button", { name: "Página siguiente" }).isDisabled(), true);
      await nav(page, kind).getByRole("combobox", { name: "Filas por página" }).selectOption("10");
      await showing(page, kind, "1–10 de 61");
      await nav(page, kind).getByRole("button", { name: "Última página" }).click();
      await showing(page, kind, "61–61 de 61");
      await page.getByRole("textbox", { name: `Buscar ${kind}`, exact: true }).fill(search);
      await showing(page, kind, "1–1 de 1");
      await nav(page, kind).getByText("Página 1 de 1", { exact: true }).waitFor();
      assert.equal(await page.locator(".clients-table tbody tr").count(), 1);
      await page.getByRole("textbox", { name: `Buscar ${kind}`, exact: true }).fill("sin coincidencias");
      await showing(page, kind, "0–0 de 0");
      await page.getByText(`No se encontraron ${kind}.`, { exact: true }).waitFor();
      await page.getByRole("textbox", { name: `Buscar ${kind}`, exact: true }).fill("");
      await showing(page, kind, "1–10 de 61");
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test("filtro de cliente: selección remota, sin cliente, búsqueda combinada y reinicio de página", { timeout: 90_000 }, async () => {
  const { browser, page, errors } = await openBrowser();
  try {
    await page.goto(`${f.base}/tickets`); await showing(page, "tickets", "1–25 de 61");
    await nav(page, "tickets").getByRole("button", { name: "Última página" }).click();
    await showing(page, "tickets", "51–61 de 61");
    const filter = page.getByRole("combobox", { name: "Filtrar por cliente", exact: true });
    await filter.click();
    await page.getByRole("combobox", { name: "Buscar filtrar por cliente", exact: true }).fill("Zulu");
    await page.getByRole("option", { name: /Zulu Café 060/ }).click();
    await showing(page, "tickets", "1–1 de 1");
    await page.getByRole("button", { name: "Editar ticket T-060", exact: true }).waitFor();
    await page.getByRole("textbox", { name: "Buscar tickets", exact: true }).fill("sin coincidencias");
    await showing(page, "tickets", "0–0 de 0");
    await page.getByRole("textbox", { name: "Buscar tickets", exact: true }).fill("");
    await showing(page, "tickets", "1–1 de 1");
    await filter.click(); await page.getByRole("option", { name: "Sin cliente", exact: true }).click();
    await showing(page, "tickets", "1–25 de 60");
    await filter.click();
    await page.getByRole("combobox", { name: "Buscar filtrar por cliente", exact: true }).fill("Cliente 055");
    await page.getByRole("option", { name: /Cliente 055/ }).click();
    await showing(page, "tickets", "0–0 de 0");
    await page.getByText("No se encontraron tickets.", { exact: true }).waitFor();
    await filter.click(); await page.getByRole("button", { name: "Todos los clientes", exact: true }).click();
    await page.keyboard.press("Escape");
    await showing(page, "tickets", "1–25 de 61");
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test("modal de ticket: cuatro grupos de vínculos, páginas, estados vacíos y móvil", { timeout: 90_000 }, async () => {
  for (const mobile of [false, true]) {
    const { browser, page, errors } = await openBrowser(mobile);
    try {
      await page.goto(`${f.base}/tickets`); await showing(page, "tickets", "1–25 de 61");
      await page.getByRole("button", { name: "Editar ticket T-000", exact: true }).click();
      const dialog = page.getByRole("dialog"), links = dialog.getByRole("complementary", { name: "Vinculado a", exact: true });
      const labels = ["Proyecto vínculos", "Módulo vinculado", "Feature vinculada", "Tarea vinculada"];
      for (const [index, scope] of linkedScopes.entries()) {
        const link = links.getByRole("link", { name: new RegExp(`^${labels[index]}`) });
        await link.waitFor();
        const path = scope.kind === "project" ? `/projects/${scope.projectId}/details` : `/projects/${scope.projectId}/${scope.kind === "module" ? "modules" : scope.kind === "feature" ? "features" : "tasks"}/${scope.id}`;
        assert.equal(await link.getAttribute("href"), path + "?tab=tickets");
        assert.equal(await link.getAttribute("target"), "_blank");
      }
      const pages = links.getByRole("navigation", { name: "Paginación de módulos vinculados", exact: true });
      await pages.getByText("Mostrando 1–25 de 31", { exact: true }).waitFor();
      await pages.getByRole("button", { name: "Página siguiente", exact: true }).click();
      await pages.getByText("Mostrando 26–31 de 31", { exact: true }).waitFor();
      await links.getByRole("link", { name: /ZZ Módulo 29/ }).waitFor();
      await links.getByRole("heading", { name: "Tareas (1)", exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: `test-results/ticket-linked-items-${mobile ? "mobile" : "desktop"}.png` });
      assert.ok(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1));
      await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
      if (!mobile) {
        await page.getByRole("textbox", { name: "Buscar tickets", exact: true }).fill("T-060");
        await showing(page, "tickets", "1–1 de 1");
        await page.getByRole("button", { name: "Editar ticket T-060", exact: true }).click();
        for (const text of ["Sin proyectos vinculados.", "Sin módulos vinculados.", "Sin features vinculadas.", "Sin tareas vinculadas."])
          await page.getByRole("dialog").getByText(text, { exact: true }).waitFor();
      }
      assert.deepEqual(errors, []);
    } finally { await browser.close(); }
  }
});

test("ticket: selector remoto de clientes y recarga de página tras editar o borrar", { timeout: 90_000 }, async () => {
  const { browser, page, errors } = await openBrowser();
  try {
    await page.goto(`${f.base}/tickets`); await showing(page, "tickets", "1–25 de 61");
    await page.getByRole("button", { name: "Editar ticket T-000", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("combobox", { name: "Cliente del ticket", exact: true }).click();
    await page.getByRole("combobox", { name: "Buscar cliente del ticket", exact: true }).fill("Cliente 055");
    await page.getByRole("option", { name: /Cliente 055/ }).click();
    await save(page, () => dialog.getByRole("button", { name: "Guardar cambios", exact: true }).click(), "ticket.update");
    await page.getByRole("row").filter({ has: page.getByRole("button", { name: "Editar ticket T-000", exact: true }) }).getByRole("cell", { name: "Cliente 055", exact: true }).waitFor();
    await nav(page, "tickets").getByRole("combobox", { name: "Filas por página" }).selectOption("10");
    await showing(page, "tickets", "1–10 de 61");
    await nav(page, "tickets").getByRole("button", { name: "Última página" }).click();
    await showing(page, "tickets", "61–61 de 61");
    await page.getByRole("button", { name: "Eliminar ticket T-060", exact: true }).click();
    await save(page, () => page.getByRole("alertdialog").getByRole("button", { name: "Eliminar", exact: true }).click(), "ticket.delete");
    await showing(page, "tickets", "51–60 de 60");
    await nav(page, "tickets").getByText("Página 6 de 6", { exact: true }).waitFor();
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test("clientes: fallo recuperable, edición conserva página y eliminación ajusta última página", { timeout: 90_000 }, async () => {
  const { browser, page, errors } = await openBrowser();
  try {
    await page.route("**/api/clients?*", (route) => route.fulfill({ status: 503, json: { error: "Catálogo temporalmente ocupado" } }));
    await page.goto(`${f.base}/clients`);
    await page.getByRole("alert").getByText("Catálogo temporalmente ocupado", { exact: false }).waitFor();
    await page.unroute("**/api/clients?*");
    await page.getByRole("button", { name: "Reintentar", exact: true }).click();
    await showing(page, "clientes", "1–25 de 61");
    await nav(page, "clientes").getByRole("button", { name: "Página siguiente" }).click();
    await showing(page, "clientes", "26–50 de 61");
    await page.getByRole("button", { name: "Editar cliente Cliente 025", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox", { name: "Nombre", exact: true }).fill("Cliente 025 editado");
    await save(page, () => dialog.getByRole("button", { name: "Guardar cambios", exact: true }).click(), "client.update");
    await page.getByRole("cell", { name: "Cliente 025 editado", exact: true }).waitFor();
    await showing(page, "clientes", "26–50 de 61");
    await nav(page, "clientes").getByRole("combobox", { name: "Filas por página" }).selectOption("10");
    await showing(page, "clientes", "1–10 de 61");
    await nav(page, "clientes").getByRole("button", { name: "Última página" }).click();
    await showing(page, "clientes", "61–61 de 61");
    await page.getByRole("button", { name: "Eliminar cliente Zulu Café 060", exact: true }).click();
    await save(page, () => page.getByRole("alertdialog").getByRole("button", { name: "Eliminar", exact: true }).click(), "client.delete");
    await showing(page, "clientes", "51–60 de 60");
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test("paginación móvil en ambos catálogos, con tema oscuro", { timeout: 90_000 }, async () => {
  const { browser, page, errors } = await openBrowser(true);
  try {
    for (const [path, kind] of [["clients", "clientes"], ["tickets", "tickets"]]) {
      await page.goto(`${f.base}/${path}`); await showing(page, kind, "1–25 de 60");
      await nav(page, kind).getByRole("button", { name: "Página siguiente" }).click();
      await showing(page, kind, "26–50 de 60");
      await nav(page, kind).getByRole("button", { name: "Última página" }).click();
      await showing(page, kind, "51–60 de 60");
      await nav(page, kind).getByRole("button", { name: "Primera página" }).click();
      await showing(page, kind, "1–25 de 60");
      await nav(page, kind).evaluate((element) => element.scrollIntoView({ block: "center" }));
      await page.screenshot({ path: `test-results/${path}-pagination-mobile.png` });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
