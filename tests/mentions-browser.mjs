import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { serializeSignedCookie } from "better-call";
import { startHttpFixture } from "./http-fixture.ts";
import { actor, addUser, authConfig } from "./helpers.ts";
import { user, session } from "../src/server/schema.ts";
import { DocumentsService } from "../src/server/documents.ts";

let f,
  projectId,
  moduleId,
  featureId,
  taskId,
  member,
  reader,
  document,
  memberCookie;
before(async () => {
  f = await startHttpFixture();
  member = await addUser(f.repo, "mentions-browser-member");
  reader = await addUser(f.repo, "mentions-browser-reader");
  const token = randomUUID();
  await f.repo.store.db.insert(session).values({
    id: randomUUID(),
    userId: member.id,
    token,
    expiresAt: new Date(Date.now() + 86400000),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  memberCookie = (
    await serializeSignedCookie(
      "better-auth.session_token",
      token,
      authConfig.BETTER_AUTH_SECRET,
      { path: "/" },
    )
  ).split(";")[0];
  await f.repo.store.db
    .update(user)
    .set({ name: "Ángela Pérez", image: "/email/taskode-mark.png" })
    .where(eq(user.id, member.id));
  projectId = (
    await f.repo.execute(
      {
        type: "project.create",
        name: "Menciones QA",
        description: "Contexto inicial",
        icon: "M",
        color: "#059669",
      },
      actor,
    )
  ).createdId;
  for (const u of [member, reader])
    await f.repo.execute(
      { type: "project.team.add", projectId, userId: u.id },
      actor,
    );
  moduleId = (
    await f.repo.execute(
      {
        type: "module.create",
        projectId,
        name: "Módulo QA",
        description: "Contexto inicial",
      },
      actor,
    )
  ).createdId;
  featureId = (
    await f.repo.execute(
      {
        type: "feature.create",
        projectId,
        moduleId,
        name: "Feature QA",
        description: "Contexto inicial",
      },
      actor,
    )
  ).createdId;
  const w = await f.repo.getWorkspace(actor);
  taskId = (
    await f.repo.execute(
      {
        type: "task.create",
        projectId,
        featureId,
        statusId: w.statuses[0].id,
        priority: "medium",
        title: "Tarea QA",
        description: "Contexto inicial",
        dueDate: null,
        labels: [],
        leaderId: actor.id,
        teamMemberIds: [member.id],
      },
      actor,
    )
  ).createdId;
  const geography = await f.repo.getGeography(actor);
  await f.repo.execute(
    {
      type: "client.create",
      name: "Cliente QA",
      cityId: geography.cities[0].id,
    },
    actor,
  );
  document = await new DocumentsService(f.repo).create(
    actor,
    "project",
    projectId,
    { title: "Manual QA", description: "", content: "Contenido inicial" },
  );
  await mkdir("test-results", { recursive: true });
});
after(async () => {
  await f?.stop();
});

async function openBrowser(
  viewport = { width: 1440, height: 1000 },
  theme = "light",
  cookie = f.cookie,
) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport });
  const split = cookie.indexOf("=");
  await context.addCookies([
    {
      name: cookie.slice(0, split),
      value: cookie.slice(split + 1),
      url: f.base,
    },
  ]);
  await context.addInitScript(
    (value) => localStorage.setItem("theme", value),
    theme,
  );
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.setDefaultTimeout(10_000);
  return { browser, page, errors };
}
const paths = () => [
  `/projects/${projectId}/details`,
  `/projects/${projectId}/modules/${moduleId}`,
  `/projects/${projectId}/features/${featureId}`,
  `/projects/${projectId}/tasks/${taskId}`,
];
async function choose(page, editor, text = "@angel") {
  await editor.click();
  await editor.press("End");
  await editor.pressSequentially(text);
  try {
    await page.getByRole("option", { name: /Ángela Pérez/ }).waitFor();
  } catch (error) {
    await page.screenshot({
      path: "test-results/mentions-suggestion-failure.png",
    });
    throw error;
  }
  await editor.press("Enter");
  assert.match(await editor.innerText(), /Ángela Pérez/);
}

test("HTTP menciones: sesión, origen, contexto, privacidad y límite", async () => {
  const endpoint = f.base + "/api/mentions/options";
  const init = {
    method: "POST",
    headers: { Cookie: f.cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ scope: { kind: "task", id: taskId, projectId } }),
  };
  assert.equal(
    (
      await fetch(endpoint, {
        ...init,
        headers: { "Content-Type": "application/json" },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await fetch(endpoint, {
        ...init,
        headers: { ...init.headers, Origin: "https://other.invalid" },
      })
    ).status,
    403,
  );
  assert.equal((await fetch(endpoint, { ...init, body: "{" })).status, 400);
  assert.equal(
    (
      await fetch(endpoint, {
        ...init,
        body: JSON.stringify({
          scope: { kind: "task", id: taskId, projectId: "other" },
        }),
      })
    ).status,
    404,
  );
  assert.equal(
    (await fetch(endpoint, { ...init, body: "x".repeat(33_000) })).status,
    413,
  );
  const response = await fetch(endpoint, init);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const options = await response.json();
  assert.ok(
    options.users.some((u) => u.id === member.id && u.email && u.image),
  );
  assert.ok(!options.users.some((u) => u.id === reader.id));
});

test(
  "comentarios y descripciones: sugerencias, teclado, hover, edición y avisos en los cuatro ámbitos",
  { timeout: 180_000 },
  async () => {
    const { browser, page, errors } = await openBrowser();
    try {
      for (const [index, path] of paths().entries()) {
        await page.goto(f.base + path);
        const composer = page.getByRole("textbox", {
          name: "Escribir comentario",
          exact: true,
        });
        await composer.waitFor();
        await choose(page, composer);
        assert.equal(
          await page.getByRole("log").locator(".mention").count(),
          0,
          "Enter selecciona sin enviar",
        );
        await composer.pressSequentially(" #clie");
        const client = page.getByRole("option", { name: /Cliente QA/ });
        await client.click();
        assert.equal(await composer.locator(".mention").count(), 2);
        await composer.press("Enter");
        const sent = page.getByRole("log").locator(".mention-user").last();
        await sent.waitFor();
        await sent.hover();
        const card = page.locator(".mention-card");
        await card.waitFor();
        if (index === 0) await page.screenshot({ path: "test-results/mentions-user-card.png" });
        assert.match(
          await card.innerText(),
          /mentions-browser-member@example.com/,
        );
        const avatar = await card.locator(".user-option-avatar").boundingBox();
        assert.ok(avatar.width >= 90 && avatar.height >= 90);
        await page.mouse.move(0, 0);
        await page
          .getByRole("log")
          .getByRole("button", { name: "Opciones del mensaje" })
          .last()
          .click();
        await page.getByRole("menuitem", { name: "Editar mensaje" }).click();
        const edit = page
          .getByRole("log")
          .getByRole("textbox", { name: "Escribir comentario" });
        assert.equal(await edit.locator(".mention").count(), 2);
        await edit.press("End");
        await edit.pressSequentially(" editado");
        await page
          .getByRole("log")
          .getByRole("button", { name: "Guardar", exact: true })
          .click();
        await page
          .getByRole("region", { name: "Editar descripción", exact: true })
          .click();
        const description = page.locator(".description-writing");
        await choose(page, description, " @angel");
        await Promise.all([
          page.waitForResponse(
            (r) =>
              r.url().endsWith("/api/workspace") &&
              r.request().method() === "POST",
          ),
          page.getByRole("button", { name: "Guardar", exact: true }).click(),
        ]);
        await page.reload();
        await page
          .getByRole("region", { name: "Editar descripción", exact: true })
          .locator(".mention-user")
          .waitFor();
        assert.equal(
          await page
            .getByRole("region", { name: "Editar descripción", exact: true })
            .locator(".mention-user")
            .count(),
          1,
        );
        assert.equal(
          (await f.repo.notifications.list(member)).items.filter(
            (n) => n.type === "mention",
          ).length,
          (index + 1) * 2,
        );
      }
      assert.deepEqual(errors, []);
      await page.screenshot({ path: "test-results/mentions-desktop.png" });
    } finally {
      await browser.close();
    }
  },
);

test(
  "documentos y formularios de creación conservan las menciones",
  { timeout: 120_000 },
  async () => {
    const { browser, page, errors } = await openBrowser();
    try {
      await page.goto(
        `${f.base}/projects/${projectId}/details?tab=documents&document=${document.id}`,
      );
      await page
        .getByRole("region", { name: "Editar contenido del documento" })
        .click();
      const content = page.getByRole("textbox", {
        name: "Contenido del documento",
      });
      await choose(page, content, " @angel");
      await page
        .getByRole("tabpanel", { name: "Documentos" })
        .getByRole("button", { name: "Guardar", exact: true })
        .click();
      await page.reload();
      await page
        .getByRole("tabpanel", { name: "Documentos" })
        .locator(".description-rendered .mention-user")
        .waitFor();
      assert.match(
        (await new DocumentsService(f.repo).get(actor, document.id)).content,
        /\/mentions\/users\/mentions-browser-member/,
      );
      await page.goto(`${f.base}/projects/${projectId}/details?tab=modules`);
      await page
        .getByRole("button", { name: "Nuevo módulo", exact: true })
        .click();
      const dialog = page.getByRole("dialog");
      await dialog
        .getByRole("textbox", { name: "Nombre del módulo" })
        .fill("Módulo con menciones");
      await dialog.getByRole("region", { name: "Editar descripción" }).click();
      await choose(page, dialog.locator(".description-writing"));
      await dialog.locator(".description-writing").pressSequentially(" #clie");
      await page.getByRole("option", { name: /Cliente QA/ }).click();
      await dialog
        .getByRole("button", { name: "Crear módulo", exact: true })
        .click();
      await dialog.waitFor({ state: "hidden" });
      assert.ok(
        (await f.repo.getWorkspace(actor)).modules.some(
          (m) =>
            m.name === "Módulo con menciones" &&
            m.description.includes("/mentions/users/"),
        ),
      );
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  },
);

test(
  "primer clic de emojis con carga fría y menciones en móvil oscuro",
  { timeout: 120_000 },
  async () => {
    const { browser, page, errors } = await openBrowser(
      { width: 390, height: 844 },
      "dark",
    );
    try {
      await page.goto(f.base + paths()[3]);
      await page.locator(".mobile-chat-toggle").click();
      const composer = page.getByRole("textbox", {
        name: "Escribir comentario",
        exact: true,
      });
      await composer.waitFor();
      await page
        .getByRole("button", { name: "Más emojis", exact: true })
        .click();
      const picker = page.getByRole("dialog", { name: "Seleccionar emoji" });
      await picker
        .getByRole("textbox", { name: "Buscar emojis", exact: true })
        .waitFor();
      const bounds = await picker.boundingBox();
      assert.ok(bounds.width > 250 && bounds.height > 250);
      assert.ok(
        bounds.x >= 0 &&
          bounds.x + bounds.width <= 390 &&
          bounds.y >= 0 &&
          bounds.y + bounds.height <= 844,
      );
      await page.screenshot({
        path: "test-results/mentions-emojis-mobile.png",
      });
      const emoji = picker.locator("button.epr-emoji").first();
      await emoji.click();
      assert.ok((await composer.innerText()).trim().length > 0);
      await composer.click();
      await composer.press("ControlOrMeta+A");
      await composer.press("Backspace");
      await choose(page, composer);
      await composer.pressSequentially(" @angel");
      await page.getByRole("listbox", { name: "Mencionar usuario" }).waitFor();
      await composer.press("Escape");
      assert.equal(await page.getByRole("dialog", { name: "Comentarios", exact: true }).isVisible(), true);
      assert.equal(
        await page.getByRole("listbox", { name: "Mencionar usuario" }).count(),
        0,
      );
      await page.screenshot({ path: "test-results/mentions-mobile-dark.png" });
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  },
);

test(
  "abrir avisos autoriza, marca lectura y muestra el comentario o documento en móvil",
  { timeout: 120_000 },
  async () => {
    const { browser, page, errors } = await openBrowser(
      { width: 390, height: 844 },
      "light",
      memberCookie,
    );
    try {
      for (const [kind, scopeId] of [
        ["project", projectId],
        ["module", moduleId],
        ["feature", featureId],
        ["task", taskId],
      ]) {
        await f.repo.execute(
          {
            type: "comment.create",
            scope: { kind, id: scopeId, projectId },
            content: `[Ángela](/mentions/users/${member.id})`,
          },
          actor,
        );
        const item = (await f.repo.notifications.list(member)).items.find(
          (n) => n.commentId && n.scope.id === scopeId,
        );
        await page.goto(`${f.base}/notifications?open=${item.id}`);
        await page.waitForURL(
          (url) => url.hash === `#comment-${item.commentId}`,
        );
        await page
          .getByRole("dialog", { name: "Comentarios", exact: true })
          .locator(`#comment-${item.commentId}`)
          .waitFor();
        assert.ok((await f.repo.notifications.get(member, item.id)).readAt);
      }
      const docItem = (await f.repo.notifications.list(member)).items.find(
        (n) => n.documentId === document.id,
      );
      assert.ok(docItem);
      await page.goto(`${f.base}/notifications?open=${docItem.id}`);
      await page.waitForURL(
        (url) => url.searchParams.get("document") === document.id,
      );
      await page
        .getByRole("tabpanel", { name: "Documentos" })
        .locator(".mention-user")
        .first()
        .waitFor();
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  },
);

test(
  "menciones atómicas: flechas, deshacer, rehacer, copiar y pegar; emojis en escritorio claro",
  { timeout: 120_000 },
  async () => {
    const { browser, page, errors } = await openBrowser();
    try {
      await page
        .context()
        .grantPermissions(["clipboard-read", "clipboard-write"]);
      await page.goto(f.base + paths()[3]);
      const composer = page.getByRole("textbox", {
        name: "Escribir comentario",
        exact: true,
      });
      await composer.click();
      await composer.pressSequentially("@");
      await page.getByRole("option", { name: /Ángela Pérez/ }).waitFor();
      await composer.press("ArrowDown");
      await composer.press("ArrowUp");
      await composer.press("Enter");
      assert.match(await composer.innerText(), /Ángela Pérez/);
      await composer.press("ControlOrMeta+Z");
      assert.equal(await composer.locator(".mention").count(), 0);
      await composer.press("ControlOrMeta+Shift+Z");
      assert.equal(await composer.locator(".mention").count(), 1);
      await composer.press("ControlOrMeta+A");
      await composer.press("ControlOrMeta+C");
      assert.ok(
        await page.evaluate(async () =>
          (await navigator.clipboard.read()).some((item) =>
            item.types.includes("text/html"),
          ),
        ),
      );
      await composer.press("End");
      await composer.press("ControlOrMeta+V");
      await page.waitForFunction(
        () =>
          document.querySelectorAll(".message-editor .mention").length === 2,
      );
      await composer.press("ControlOrMeta+A");
      await composer.press("Backspace");
      await composer.pressSequentially("correo@example.com");
      assert.equal(
        await page.getByRole("listbox", { name: "Mencionar usuario" }).count(),
        0,
      );
      await composer.press("ControlOrMeta+A");
      await composer.press("Backspace");
      await composer.pressSequentially("AB");
      await composer.press("ArrowLeft");
      await page
        .getByRole("button", { name: "Más emojis", exact: true })
        .click();
      const picker = page.getByRole("dialog", { name: "Seleccionar emoji" });
      await picker.locator("button.epr-emoji").first().click();
      await page.waitForFunction(() =>
        /^A.+B$/.test(
          document.querySelector(".message-editor").innerText.trim(),
        ),
      );
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  },
);
