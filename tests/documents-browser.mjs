import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { startHttpFixture } from "./http-fixture.ts";
import { actor } from "./helpers.ts";
import { DiagramsService } from "../src/server/diagrams.ts";
import { DocumentsService } from "../src/server/documents.ts";
import { emptyDiagramScene } from "../src/lib/diagrams.ts";

let fixture, projectId, moduleId, featureId, taskId, diagram;
before(async () => {
  fixture = await startHttpFixture();
  const repo = fixture.repo;
  projectId = (
    await repo.execute(
      {
        type: "project.create",
        name: "Documentación del equipo",
        description: "",
        icon: "D",
        color: "#059669",
      },
      actor,
    )
  ).createdId;
  moduleId = (
    await repo.execute(
      {
        type: "module.create",
        projectId,
        name: "Operaciones",
        description: "",
      },
      actor,
    )
  ).createdId;
  featureId = (
    await repo.execute(
      {
        type: "feature.create",
        projectId,
        moduleId,
        name: "Acceso",
        description: "",
      },
      actor,
    )
  ).createdId;
  taskId = (
    await repo.execute(
      {
        type: "task.create",
        projectId,
        featureId,
        statusId: (await repo.getWorkspace(actor)).statuses[0].id,
        title: "Documentar acceso",
        description: "",
        priority: "medium",
        dueDate: null,
        labels: [],
      },
      actor,
    )
  ).createdId;
  const scene = emptyDiagramScene();
  scene.elements.push({
    id: "rect",
    type: "rectangle",
    x: 10,
    y: 10,
    width: 240,
    height: 100,
    angle: 0,
    strokeColor: "#059669",
    backgroundColor: "#d1fae5",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: 1,
    version: 1,
    versionNonce: 1,
    index: "a0",
    isDeleted: false,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
  });
  diagram = await new DiagramsService(repo).create(
    actor,
    "project",
    projectId,
    { title: "Flujo del proyecto", description: "Referencia general", scene },
  );
  await mkdir("test-results", { recursive: true });
});
after(async () => {
  await fixture?.stop();
});

test("HTTP documentos: sesión, origen, validación, revisión, ámbito y adjuntos históricos", async () => {
  const endpoint = `/api/entities/project/${projectId}/documents`;
  const request = (path, init = {}) =>
    fetch(fixture.base + path, {
      ...init,
      headers: {
        Cookie: fixture.cookie,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
  assert.equal((await fetch(fixture.base + endpoint)).status, 401);
  assert.equal(
    (
      await request(endpoint, {
        method: "POST",
        headers: { Origin: "https://other.invalid" },
        body: "{}",
      })
    ).status,
    403,
  );
  assert.equal(
    (await request(endpoint, { method: "POST", body: "{" })).status,
    400,
  );
  assert.equal(
    (
      await request(endpoint, {
        method: "POST",
        body: JSON.stringify({ title: "", description: "", content: "" }),
      })
    ).status,
    400,
  );
  assert.equal(
    (await request(endpoint, { method: "POST", body: "x".repeat(130001) }))
      .status,
    413,
  );
  const payload = {
    title: "HTTP",
    description: "Contexto",
    content: "Contenido",
  };
  const created = await request(endpoint, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  assert.equal(created.status, 200);
  assert.match(created.headers.get("cache-control"), /private, no-store/);
  const document = await created.json();
  assert.equal(
    (
      await request(`/api/documents/${document.id}`, {
        method: "PUT",
        body: JSON.stringify({ ...payload, revision: 1 }),
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request(`/api/documents/${document.id}`, {
        method: "PUT",
        body: JSON.stringify({ ...payload, revision: 1 }),
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await request(
        `/api/entities/task/${taskId}/document-diagrams/${diagram.id}`,
      )
    ).status,
    200,
  );
  assert.equal(
    (await request(`/api/entities/project/${projectId}/document-diagrams`))
      .status,
    200,
  );
  const legacy = await request("/api/files/uploads", {
    method: "POST",
    body: JSON.stringify({
      projectId,
      name: "legacy.pdf",
      size: 10,
      purpose: "document",
    }),
  });
  assert.equal(legacy.status, 200);
  const upload = await legacy.json();
  const row = await fixture.repo.store.pool.query(
    "select purpose from files where id = $1",
    [upload.id],
  );
  assert.equal(row.rows[0].purpose, "file");
  assert.equal(
    (await request(`/api/documents/${document.id}`, { method: "DELETE" }))
      .status,
    200,
  );
  assert.equal((await request(`/api/documents/${document.id}`)).status, 404);
});

test(
  "Documentos en navegador: colección, Markdown, Draw actualizado, borradores y móvil",
  { timeout: 180_000 },
  async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1050 },
      });
      const split = fixture.cookie.indexOf("=");
      await context.addCookies([
        {
          name: fixture.cookie.slice(0, split),
          value: fixture.cookie.slice(split + 1),
          url: fixture.base,
        },
      ]);
      const page = await context.newPage(),
        errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(
        `${fixture.base}/projects/${projectId}/details?tab=documents`,
      );
      await page
        .getByRole("button", { name: "Nuevo documento", exact: true })
        .click();
      let dialog = page.getByRole("dialog");
      await dialog
        .getByRole("textbox", { name: "Título", exact: true })
        .fill("Manual operativo");
      await dialog
        .getByRole("textbox", { name: "Descripción breve", exact: true })
        .fill("Decisiones y procedimientos del equipo");
      await dialog
        .getByRole("button", { name: "Crear documento", exact: true })
        .click();
      await page
        .getByRole("textbox", { name: "Título del documento", exact: true })
        .waitFor();
      const id = new URL(page.url()).searchParams.get("document");
      assert.ok(id);
      const inlineTitle = page.getByRole("textbox", {
        name: "Título del documento",
        exact: true,
      });
      const inlineDescription = page.getByRole("textbox", {
        name: "Descripción breve del documento",
        exact: true,
      });
      assert.equal(
        await inlineTitle.getAttribute("contenteditable"),
        "plaintext-only",
      );
      assert.equal(
        await inlineDescription.getAttribute("contenteditable"),
        "plaintext-only",
      );
      assert.equal(
        await page
          .getByRole("region", { name: "Editor de documento", exact: true })
          .locator("label")
          .count(),
        0,
      );
      await inlineDescription.fill("Edición temporal");
      await inlineDescription.press("Escape");
      assert.equal(
        await inlineDescription.innerText(),
        "Decisiones y procedimientos del equipo",
      );
      await inlineDescription.fill("Resumen actualizado inline");
      await inlineDescription.press("Enter");
      await page
        .getByRole("region", {
          name: "Editar contenido del documento",
          exact: true,
        })
        .click();
      const editor = page.getByRole("textbox", {
        name: "Contenido del documento",
        exact: true,
      });
      await editor.fill("Contexto inicial del documento");
      await page
        .getByRole("button", { name: "Insertar diagrama", exact: true })
        .click();
      dialog = page.getByRole("dialog");
      await dialog
        .getByRole("textbox", { name: "Buscar diagramas" })
        .fill("Flujo del proyecto");
      await dialog.getByRole("button", { name: /Flujo del proyecto/ }).click();
      const preview = page.getByRole("link", {
        name: "Abrir diagrama Flujo del proyecto en Draw",
        exact: true,
      });
      await preview.waitFor();
      await preview.locator("img").waitFor();
      assert.ok(
        await preview.locator("img").evaluate((img) => img.naturalWidth > 0),
      );
      await preview.getByText("Referencia general", { exact: true }).waitFor();
      const thumbnail = await preview.locator("img").boundingBox();
      const marker = await preview.boundingBox();
      const markerTitle = await preview
        .getByText("Flujo del proyecto", { exact: true })
        .boundingBox();
      assert.ok(thumbnail.width <= 96 && thumbnail.height <= 72);
      assert.ok(marker.height <= 100 && thumbnail.x < markerTitle.x);
      await page
        .getByRole("button", { name: "Arrastrar diagrama", exact: true })
        .waitFor();
      await page
        .getByRole("button", {
          name: "Quitar diagrama del documento",
          exact: true,
        })
        .click();
      assert.equal(await preview.count(), 0);
      await page.getByRole("button", { name: "Deshacer", exact: true }).click();
      await preview.waitFor();
      await editor.press("Control+End");
      await editor.evaluate((element) => {
        const bytes = Uint8Array.from(
          atob(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aPZ8AAAAASUVORK5CYII=",
          ),
          (character) => character.charCodeAt(0),
        );
        const clipboard = new DataTransfer();
        clipboard.items.add(
          new File([bytes], "nota.png", { type: "image/png" }),
        );
        element.dispatchEvent(
          new ClipboardEvent("paste", {
            clipboardData: clipboard,
            bubbles: true,
            cancelable: true,
          }),
        );
      });
      await editor.locator('img[src^="/api/files/"]').waitFor();
      await page
        .getByRole("region", { name: "Editor de documento", exact: true })
        .getByRole("button", { name: "Guardar", exact: true })
        .click();
      await page.getByText("Documento guardado.", { exact: true }).waitFor();
      const saved = await new DocumentsService(fixture.repo).get(actor, id);
      assert.match(saved.content, /Contexto inicial del documento/);
      assert.equal(saved.description, "Resumen actualizado inline");
      assert.match(saved.content, new RegExp(diagram.id));
      await page.screenshot({
        path: "test-results/documents-desktop.png",
        fullPage: true,
      });
      // A pending document stays intact while the referenced drawing is edited.
      await page
        .getByRole("textbox", { name: "Título del documento", exact: true })
        .fill("Borrador conservado");
      const popupPromise = page.waitForEvent("popup");
      await page
        .getByRole("link", {
          name: "Abrir diagrama Flujo del proyecto en Draw",
          exact: true,
        })
        .click();
      const popup = await popupPromise;
      await popup
        .getByRole("textbox", { name: "Título del diagrama", exact: true })
        .fill("Flujo actualizado");
      await popup.getByRole("button", { name: "Guardar", exact: true }).click();
      await popup.getByText("Diagrama guardado.", { exact: true }).waitFor();
      await popup.close();
      await page.bringToFront();
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await page
        .getByRole("link", {
          name: "Abrir diagrama Flujo actualizado en Draw",
          exact: true,
        })
        .waitFor();
      assert.equal(
        await page
          .getByRole("textbox", { name: "Título del documento", exact: true })
          .innerText(),
        "Borrador conservado",
      );
      await page.getByRole("tab", { name: "Archivos", exact: true }).click();
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: "Seguir editando" })
        .click();
      await page
        .getByRole("button", { name: "Descartar", exact: true })
        .click();
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: "Salir sin guardar" })
        .click();
      assert.equal(
        await page
          .getByRole("textbox", { name: "Título del documento", exact: true })
          .innerText(),
        "Manual operativo",
      );
      const documentUrl = page.url();
      await page.getByRole("tab", { name: "Archivos", exact: true }).click();
      await page.getByText("nota.png", { exact: true }).waitFor();
      await page.goto(documentUrl);
      await page
        .getByRole("region", {
          name: "Editar contenido del documento",
          exact: true,
        })
        .locator('img[src^="/api/files/"]')
        .waitFor();
      await page
        .getByRole("link", {
          name: "Abrir diagrama Flujo actualizado en Draw",
          exact: true,
        })
        .waitFor();
      // Re-entering the rich editor preserves the diagram atom and ordinary text.
      await page
        .getByRole("region", {
          name: "Editar contenido del documento",
          exact: true,
        })
        .click({ position: { x: 10, y: 12 } });
      await page
        .getByRole("textbox", { name: "Contenido del documento", exact: true })
        .waitFor();
      await page
        .getByRole("textbox", { name: "Contenido del documento", exact: true })
        .locator('img[src^="/api/files/"]')
        .waitFor();
      await page
        .getByRole("link", {
          name: "Abrir diagrama Flujo actualizado en Draw",
          exact: true,
        })
        .waitFor();
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({
        path: "test-results/documents-mobile.png",
        fullPage: true,
      });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth,
        ),
        false,
      );
      // The four entity detail screens expose separate Files and Documents tabs.
      for (const path of [
        `/projects/${projectId}/modules/${moduleId}`,
        `/projects/${projectId}/features/${featureId}`,
        `/projects/${projectId}/tasks/${taskId}`,
      ]) {
        await page.goto(fixture.base + path + "?tab=documents");
        await page
          .getByRole("tab", { name: "Archivos", exact: true })
          .waitFor();
        await page
          .getByRole("button", { name: "Nuevo documento", exact: true })
          .waitFor();
      }
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  },
);
