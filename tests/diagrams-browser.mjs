import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { startHttpFixture } from "./http-fixture.ts";
import { actor } from "./helpers.ts";
import { DiagramsService } from "../src/server/diagrams.ts";
import { emptyDiagramScene } from "../src/lib/diagrams.ts";

let fixture, projectId, moduleId, featureId, taskId, document;
before(async () => {
  fixture = await startHttpFixture();
  projectId = (
    await fixture.repo.execute(
      {
        type: "project.create",
        name: "Plataforma de clientes",
        description: "Un espacio de trabajo para pensar visualmente.",
        icon: "P",
        color: "#059669",
      },
      actor,
    )
  ).createdId;
  moduleId = (
    await fixture.repo.execute(
      {
        type: "module.create",
        projectId,
        name: "Identidad y acceso",
        description: "",
      },
      actor,
    )
  ).createdId;
  featureId = (
    await fixture.repo.execute(
      {
        type: "feature.create",
        projectId,
        moduleId,
        name: "Autenticación",
        description: "",
      },
      actor,
    )
  ).createdId;
  const w = await fixture.repo.getWorkspace(actor);
  taskId = (
    await fixture.repo.execute(
      {
        type: "task.create",
        projectId,
        featureId,
        statusId: w.statuses[0].id,
        title: "Diseñar el acceso",
        description: "",
        priority: "medium",
        dueDate: null,
        labels: [],
      },
      actor,
    )
  ).createdId;
  const service = new DiagramsService(fixture.repo);
  document = await service.create(actor, "project", projectId, {
    title: "Flujo de autenticación",
    description:
      "Del primer acceso a una sesión segura. Puntos de entrada y validación del usuario.",
    scene: emptyDiagramScene(),
  });
  await service.create(actor, "project", projectId, {
    title: "Arquitectura de servicios",
    description:
      "Responsabilidades de la aplicación, la API y la capa de persistencia.",
    scene: emptyDiagramScene(),
  });
  await service.create(actor, "project", projectId, {
    title: "Recorrido del cliente",
    description:
      "Las etapas principales del onboarding y la activación de una cuenta.",
    scene: emptyDiagramScene(),
  });
  await mkdir("test-results", { recursive: true });
});
after(async () => {
  await fixture?.stop();
});

test(
  "Diagramas en navegador: lista, editor, imágenes, guardado, móvil y enlace público",
  { timeout: 150_000 },
  async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
      });
      await context.addInitScript(() => {
        delete window.showOpenFilePicker;
        delete window.showSaveFilePicker;
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
        errors = [],
        resources = [],
        scripts = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("request", (r) => resources.push(r.url()));
      page.on("response", (response) => {
        if (response.request().resourceType() === "script")
          scripts.push(response.text().catch(() => ""));
      });
      const details = `${fixture.base}/projects/${projectId}/details`;
      await page.goto(details);
      await page.getByRole("tab", { name: "Diagramas", exact: true }).click();
      const projectTabs = await page.getByRole("tab").allTextContents();
      assert.equal(
        projectTabs.findIndex((text) => text.trim().startsWith("Diagramas")),
        projectTabs.findIndex((text) => text.trim().startsWith("Documentos")) +
          1,
      );
      await page
        .getByRole("heading", {
          name: "Arquitectura de servicios",
          exact: true,
        })
        .waitFor();
      assert.equal(
        resources.some((url) => /excalidraw\/fonts|diagram-canvas/.test(url)),
        false,
      );
      assert.equal(
        (await Promise.all(scripts)).some((source) =>
          source.includes("EXCALIDRAW_ASSET_PATH"),
        ),
        false,
      );
      await page.screenshot({ path: "test-results/diagrams-list.png" });
      await page
        .getByRole("heading", { name: "Flujo de autenticación", exact: true })
        .click();
      await page.locator(".excalidraw canvas.interactive").waitFor();
      assert.equal(
        await page
          .locator('section[aria-label="Editor de diagrama"] > header')
          .getByLabel("Título del diagrama", { exact: true })
          .count(),
        1,
      );
      assert.equal(
        await page
          .locator('section[aria-label="Editor de diagrama"] > header')
          .getByText("DIAGRAMA", { exact: true })
          .count(),
        0,
      );
      assert.equal(
        await page
          .locator('section[aria-label="Editor de diagrama"] > header')
          .getByText("Guardado", { exact: true })
          .count(),
        0,
      );
      assert.equal(
        await page
          .locator('section[aria-label="Editor de diagrama"] > header')
          .getByLabel("Descripción del diagrama", { exact: true })
          .count(),
        1,
      );
      await page.screenshot({
        path: "test-results/diagrams-editor-normal.png",
      });
      await page
        .getByLabel("Título del diagrama", { exact: true })
        .fill("Flujo de autenticación · revisado");
      const editorHeader = page.locator('section[aria-label="Editor de diagrama"] > header');
      const canvas = page.locator(".excalidraw canvas.interactive");
      const expandedCanvas = await canvas.boundingBox();
      assert.ok((await editorHeader.boundingBox()).height <= 64);
      const descriptionBounds = await page.getByLabel("Descripción del diagrama", { exact: true }).boundingBox();
      const titleBounds = await page.getByLabel("Título del diagrama", { exact: true }).boundingBox();
      assert.ok(descriptionBounds.y >= titleBounds.y + titleBounds.height);
      assert.ok(Math.abs(descriptionBounds.width - (await editorHeader.boundingBox()).width) <= 2);
      await page.getByRole("button", { name: "Ocultar cabecera", exact: true }).click();
      await editorHeader.waitFor({ state: "hidden" });
      await page.waitForFunction((height) =>
        document.querySelector(".excalidraw canvas.interactive").getBoundingClientRect().height > height + 40,
        expandedCanvas.height,
      );
      assert.equal(await page.getByRole("alertdialog").count(), 0);
      await page.screenshot({ path: "test-results/diagrams-editor-collapsed.png" });
      await page.getByRole("button", { name: "Mostrar cabecera", exact: true }).click();
      assert.equal(
        await page.getByLabel("Título del diagrama", { exact: true }).inputValue(),
        "Flujo de autenticación · revisado",
      );
      await page
        .getByRole("button", { name: "Volver a diagramas", exact: true })
        .click();
      await page.getByRole("alertdialog").waitFor();
      await page
        .getByRole("button", { name: "Seguir editando", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Guardar", exact: true })
        .filter({ hasNot: page.locator(".does-not-exist") })
        .last()
        .click();
      await page.getByText("Diagrama guardado.", { exact: true }).waitFor();
      const saved = await new DiagramsService(fixture.repo).get(
        actor,
        document.id,
      );
      assert.equal(saved.title, "Flujo de autenticación · revisado");
      // The editor's keyboard shortcuts exercise real canvas interactions.
      await page
        .locator(".excalidraw canvas.interactive")
        .click({ position: { x: 200, y: 150 } });
      await page.keyboard.press("r");
      const bounds = await page
        .locator(".excalidraw canvas.interactive")
        .boundingBox();
      await page.mouse.move(bounds.x + 200, bounds.y + 160);
      await page.mouse.down();
      await page.mouse.move(bounds.x + 440, bounds.y + 300, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(400);
      const canvasSave = page
        .getByRole("button", { name: "Guardar", exact: true })
        .last();
      assert.equal(await canvasSave.isEnabled(), true);
      await canvasSave.click();
      await page.waitForTimeout(500);
      assert.ok(
        (await new DiagramsService(fixture.repo).get(actor, document.id)).scene
          .elements.length > 0,
      );
      // Paste a real raster image through the editor's clipboard handler.
      {
        await page
          .locator(".excalidraw canvas.interactive")
          .click({ position: { x: 100, y: 100 } });
        await page.evaluate(() => {
          const canvas = document.createElement("canvas");
          canvas.width = 180;
          canvas.height = 90;
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = "#e0f2ec";
          ctx.fillRect(0, 0, 180, 90);
          ctx.fillStyle = "#07835e";
          ctx.font = "18px sans-serif";
          ctx.fillText("Cliente → API", 25, 50);
          const bytes = Uint8Array.from(
            atob(canvas.toDataURL("image/png").split(",")[1]),
            (c) => c.charCodeAt(0),
          );
          const transfer = new DataTransfer();
          transfer.items.add(
            new File([bytes], "pixel.png", { type: "image/png" }),
          );
          document.querySelector(".excalidraw").dispatchEvent(
            new ClipboardEvent("paste", {
              clipboardData: transfer,
              bubbles: true,
              cancelable: true,
            }),
          );
        });
        await page.waitForTimeout(700);
        await page.screenshot({ path: "test-results/diagrams-image.png" });
        await canvasSave.click();
        await page.waitForTimeout(500);
        assert.ok(
          Object.keys(
            (await new DiagramsService(fixture.repo).get(actor, document.id))
              .scene.files,
          ).length > 0,
        );
      }
      // Reopening a populated scene may normalize records and measure fonts.
      // These loading changes must not create a draft or block navigation.
      const beforeReopen = await new DiagramsService(fixture.repo).get(
        actor,
        document.id,
      );
      await page
        .getByRole("button", { name: "Volver a diagramas", exact: true })
        .click();
      await page
        .getByRole("heading", { name: beforeReopen.title, exact: true })
        .click();
      await page.locator(".excalidraw canvas.interactive").waitFor();
      await page.waitForTimeout(600);
      assert.equal(
        await page
          .getByRole("button", { name: "Guardar", exact: true })
          .last()
          .isEnabled(),
        false,
      );
      await page.getByRole("tab", { name: "Descripción", exact: true }).click();
      await page
        .locator('[role="tab"][data-state="active"]')
        .filter({ hasText: "Descripción" })
        .waitFor();
      assert.equal(await page.getByRole("alertdialog").count(), 0);
      await page.getByRole("tab", { name: "Diagramas", exact: true }).click();
      await page
        .getByRole("heading", { name: beforeReopen.title, exact: true })
        .click();
      await page.locator(".excalidraw canvas.interactive").waitFor();
      assert.equal(
        (await new DiagramsService(fixture.repo).get(actor, document.id))
          .revision,
        beforeReopen.revision,
      );
      await page
        .getByRole("button", { name: "Pantalla completa", exact: true })
        .click();
      await page
        .getByRole("button", {
          name: "Salir de pantalla completa",
          exact: true,
        })
        .waitFor();
      await page.screenshot({ path: "test-results/diagrams-editor-full.png" });
      assert.equal(await page.getByLabel("Descripción del diagrama", { exact: true }).isVisible(), false);
      await page
        .getByRole("button", {
          name: "Salir de pantalla completa",
          exact: true,
        })
        .click();
      const popup = page.waitForEvent("popup");
      assert.equal(await page.getByLabel("Descripción del diagrama", { exact: true }).isVisible(), true);
      await page
        .getByRole("button", { name: "Abrir en otra pestaña", exact: true })
        .click();
      const another = await popup;
      await another
        .getByLabel("Título del diagrama", { exact: true })
        .waitFor();
      await another
        .getByLabel("Descripción del diagrama", { exact: true })
        .fill("Actualizado en otra pestaña.");
      await another
        .getByRole("button", { name: "Guardar", exact: true })
        .click();
      await another.getByText("Diagrama guardado.", { exact: true }).waitFor();
      assert.equal(
        (await new DiagramsService(fixture.repo).get(actor, document.id))
          .description,
        "Actualizado en otra pestaña.",
      );
      await another.close();
      await page
        .getByLabel("Descripción del diagrama", { exact: true })
        .fill("Mi borrador sigue aquí.");
      await canvasSave.click();
      await page
        .getByRole("button", { name: "Recargar versión guardada" })
        .waitFor();
      assert.equal(
        await page
          .getByLabel("Descripción del diagrama", { exact: true })
          .inputValue(),
        "Mi borrador sigue aquí.",
      );
      await page
        .getByRole("button", { name: "Recargar versión guardada" })
        .click();
      await page
        .getByRole("button", { name: "Salir sin guardar", exact: true })
        .click();
      await page
        .waitForFunction(
          () =>
            document.querySelector('[aria-label="Descripción del diagrama"]')
              .value === "Actualizado en otra pestaña.",
          undefined,
          { timeout: 3000 },
        )
        .catch(async (error) => {
          console.log(
            "Reload state:",
            await page
              .getByLabel("Descripción del diagrama", { exact: true })
              .inputValue(),
            await page.getByRole("alert").allTextContents(),
          );
          await page.screenshot({ path: "test-results/diagrams-conflict.png" });
          throw error;
        });
      await page
        .getByRole("button", { name: "Compartir", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Activar enlace público", exact: true })
        .click();
      const publicUrl = await page
        .getByRole("textbox", { name: "Enlace público", exact: true })
        .inputValue();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Cerrar", exact: true })
        .first()
        .click();
      const anonContext = await browser.newContext({
        viewport: { width: 1200, height: 850 },
      });
      const publicPage = await anonContext.newPage();
      await publicPage.goto(publicUrl);
      await publicPage.locator(".excalidraw canvas.interactive").waitFor();
      assert.equal(
        await publicPage
          .getByRole("heading", { name: saved.title, exact: true })
          .count(),
        1,
      );
      assert.equal(
        await publicPage
          .getByRole("button", { name: "Guardar", exact: true })
          .count(),
        0,
      );
      assert.equal(
        await publicPage.locator(".app-sidebar, .workspace-sidebar").count(),
        0,
      );
      await publicPage.screenshot({ path: "test-results/diagrams-public.png" });
      await page
        .getByRole("button", { name: "Compartir", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Desactivar enlace", exact: true })
        .click();
      await page
        .getByText("Enlace público desactivado.", { exact: true })
        .waitFor();
      const revoked = await publicPage.reload();
      assert.equal(revoked.status(), 404);
      await publicPage
        .getByRole("heading", { name: "Diagrama no disponible", exact: true })
        .waitFor();
      await anonContext.close();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Cerrar", exact: true })
        .first()
        .click();
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: "test-results/diagrams-mobile.png" });
      await page.getByRole("button", { name: "Ocultar cabecera", exact: true }).click();
      await editorHeader.waitFor({ state: "hidden" });
      await page.screenshot({ path: "test-results/diagrams-mobile-collapsed.png" });
      await page.getByRole("button", { name: "Mostrar cabecera", exact: true }).click();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      await page.evaluate(() => localStorage.setItem("theme", "dark"));
      await page.reload();
      await page.locator(".excalidraw canvas.interactive").waitFor();
      await page.screenshot({ path: "test-results/diagrams-dark.png" });
      for (const path of [
        `modules/${moduleId}`,
        `features/${featureId}`,
        `tasks/${taskId}`,
      ]) {
        await page.goto(
          `${fixture.base}/projects/${projectId}/${path}?tab=diagrams`,
        );
        await page
          .getByRole("heading", {
            name: "Una idea se entiende mejor cuando la dibujas.",
            exact: true,
          })
          .waitFor();
        const tabs = await page.getByRole("tab").allTextContents();
        assert.equal(
          tabs.findIndex((text) => text.trim().startsWith("Diagramas")),
          tabs.findIndex((text) => text.trim().startsWith("Documentos")) + 1,
        );
      }
      await page
        .getByRole("button", { name: "Crear el primer diagrama", exact: true })
        .click();
      await page
        .getByRole("dialog")
        .getByLabel("Título", { exact: true })
        .fill("Diagrama de tarea");
      await page
        .getByRole("button", { name: "Crear diagrama", exact: true })
        .click();
      await page.getByLabel("Título del diagrama", { exact: true }).waitFor();
      await page
        .getByRole("button", { name: "Volver a diagramas", exact: true })
        .click();
      await page
        .getByRole("button", {
          name: "Eliminar Diagrama de tarea",
          exact: true,
        })
        .click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Eliminar diagrama", exact: true })
        .click();
      await page
        .getByRole("heading", {
          name: "Una idea se entiende mejor cuando la dibujas.",
          exact: true,
        })
        .waitFor();
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  },
);
