import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { chromium, firefox, webkit } from "playwright";
import { startHttpFixture } from "./http-fixture.ts";
import { actor, addUser, authConfig } from "./helpers.ts";
import { session } from "../src/server/schema.ts";
import { randomUUID } from "node:crypto";
import { serializeSignedCookie } from "better-call";
import webpush from "web-push";
import { mkdir } from "node:fs/promises";

let fixture, memberCookie;
before(async () => {
  fixture = await startHttpFixture();
  const user = await addUser(fixture.repo, "browser-member");
  const projectId = (
    await fixture.repo.execute(
      {
        type: "project.create",
        name: "Avisos de prueba",
        description: "",
        icon: "🔔",
        color: "#059669",
      },
      actor,
    )
  ).createdId;
  await fixture.repo.execute(
    { type: "project.team.add", projectId, userId: user.id },
    actor,
  );
  const w = await fixture.repo.getWorkspace(actor);
  for (let i = 0; i < 35; i++)
    await fixture.repo.execute(
      {
        type: "task.create",
        projectId,
        featureId: w.features[0].id,
        statusId: w.statuses[0].id,
        title: `Entrega ${i + 1}`,
        description: "Descripción de prueba",
        priority: "medium",
        labels: [],
        dueDate: null,
        leaderId: user.id,
      },
      actor,
    );
  const now = new Date(),
    token = randomUUID();
  await fixture.repo.store.db.insert(session).values({
    id: randomUUID(),
    userId: user.id,
    token,
    createdAt: now,
    updatedAt: now,
    expiresAt: new Date(Date.now() + 86400000),
  });
  memberCookie = (
    await serializeSignedCookie(
      "better-auth.session_token",
      token,
      authConfig.BETTER_AUTH_SECRET,
      { path: "/" },
    )
  ).split(";")[0];
  await mkdir("test-results", { recursive: true });
});
after(async () => {
  await fixture?.stop();
});
async function waitFor(check) {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.fail("La condición no se cumplió en cinco segundos");
}
async function openSettings(page) {
  if (
    await page.getByRole("button", { name: "Abrir barra lateral" }).isVisible()
  )
    await page.getByRole("button", { name: "Abrir barra lateral" }).click();
  await page.getByRole("button", { name: "Menú de usuario" }).click();
  await page
    .getByRole("menuitem", { name: "Configuración", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Notificaciones", exact: true })
    .click();
  await page.getByRole("button", { name: "Guardar preferencias" }).waitFor();
}
for (const [name, engine] of [
  ["chromium", chromium],
  ["firefox", firefox],
  ["webkit", webkit],
]) {
  test(
    `Navegador ${name}: campana, paginación, móvil, lectura, guardado y push`,
    { timeout: 90000 },
    async () => {
      const browser = await engine.launch({ headless: true });
      try {
        const context = await browser.newContext({
          viewport: { width: 1440, height: 1000 },
        });
        const split = memberCookie.indexOf("=");
        await context.addCookies([
          {
            name: memberCookie.slice(0, split),
            value: memberCookie.slice(split + 1),
            url: fixture.base,
          },
        ]);
        const page = await context.newPage(),
          errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await page.goto(fixture.base + "/notifications");
        await page.getByText("Entrega 35", { exact: true }).waitFor();
        assert.equal(await page.locator("[data-sonner-toast]").count(), 0);
        await page.getByRole("button", { name: /^Notificaciones,/ }).click();
        assert.equal(
          await page.getByRole("dialog").locator(".notification-row").count(),
          10,
        );
        await page.keyboard.press("Escape");
        await waitFor(async () =>
          (
            await page.evaluate(() =>
              document.activeElement?.getAttribute("aria-label"),
            )
          )?.includes("Notificaciones"),
        );
        assert.match(
          await page.evaluate(() =>
            document.activeElement?.getAttribute("aria-label"),
          ),
          /Notificaciones/,
        );
        await page
          .getByRole("button", { name: "Cargar más", exact: true })
          .click();
        await waitFor(
          async () =>
            (await page.locator("main .notification-row").count()) === 35,
        );
        await page.screenshot({
          path: `test-results/notifications-${name}-desktop.png`,
        });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.getByRole("button", { name: /^Notificaciones,/ }).click();
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
          false,
        );
        await page.screenshot({
          path: `test-results/notifications-${name}-mobile.png`,
        });
        await page
          .getByRole("dialog")
          .getByRole("button", { name: /te asignó una tarea.*Entrega 35/ })
          .click();
        await page.waitForURL("**/tasks/**");
        await page
          .getByRole("region", { name: "Editar descripción", exact: true })
          .click();
        const description = page.getByRole("textbox", {
          name: "Descripción de la tarea",
          exact: true,
        });
        await description.fill("Edición sin guardar");
        await page.getByRole("button", { name: /^Notificaciones/ }).click();
        await page
          .getByRole("button", { name: "Ver todas", exact: true })
          .click();
        await page.getByRole("alertdialog").waitFor();
        await page.getByRole("button", { name: "Seguir editando" }).click();
        assert.match(page.url(), /\/tasks\//);
        await page
          .getByRole("region", { name: "Editar descripción", exact: true })
          .click();
        await description.fill("Descripción de prueba");
        await openSettings(page);
        const dialog = page.getByRole("dialog");
        await dialog.locator("input[type=time]").fill("09:45");
        await page
          .getByRole("button", { name: "Guardar preferencias" })
          .click();
        await waitFor(
          async () =>
            (
              await (
                await page.request.get(
                  fixture.base + "/api/notification-preferences",
                )
              ).json()
            ).preferences.dateOnlyTime === "09:45",
        );
        // Simulate platform permissions without contacting a real push provider.
        await dialog
          .getByRole("button", { name: "Cerrar", exact: true })
          .click();
        const key = webpush.generateVAPIDKeys().publicKey;
        await page.route("**/api/notification-preferences", async (route) => {
          const response = await route.fetch();
          const data = await response.json();
          await route.fulfill({
            response,
            json: { ...data, push: { enabled: true, publicKey: key } },
          });
        });
        await page.route("**/api/push/subscriptions", (route) =>
          route.fulfill({ json: { ok: true } }),
        );
        await page.evaluate(() => {
          window.__permissionRequests = 0;
          class FakeNotification {
            static permission = "default";
            static async requestPermission() {
              window.__permissionRequests++;
              return (FakeNotification.permission = "granted");
            }
          }
          Object.defineProperty(window, "Notification", {
            configurable: true,
            value: FakeNotification,
          });
          Object.defineProperty(window, "PushManager", {
            configurable: true,
            value: class {},
          });
          const subscription = {
            endpoint: "https://fcm.googleapis.com/test",
            toJSON() {
              return {
                endpoint: this.endpoint,
                keys: { auth: "test", p256dh: "test" },
              };
            },
            async unsubscribe() {
              return true;
            },
          };
          const registration = {
            pushManager: {
              async getSubscription() {
                return null;
              },
              async subscribe() {
                return subscription;
              },
            },
          };
          Object.defineProperty(navigator, "serviceWorker", {
            configurable: true,
            value: {
              async register() {
                return registration;
              },
              ready: Promise.resolve(registration),
              async getRegistration() {
                return registration;
              },
              addEventListener() {},
              removeEventListener() {},
            },
          });
        });
        await openSettings(page);
        assert.equal(await page.evaluate(() => window.__permissionRequests), 0);
        await page
          .getByRole("button", { name: "Activar notificaciones", exact: true })
          .click();
        await page
          .getByRole("button", {
            name: "Desactivar en este dispositivo",
            exact: true,
          })
          .waitFor();
        assert.equal(await page.evaluate(() => window.__permissionRequests), 1);
        await page
          .getByRole("dialog")
          .getByRole("button", { name: "Cerrar", exact: true })
          .click();
        await page.evaluate(() => {
          Notification.permission = "default";
          Notification.requestPermission = async () =>
            (Notification.permission = "denied");
        });
        await openSettings(page);
        await page
          .getByRole("button", { name: "Activar notificaciones", exact: true })
          .click();
        await page
          .getByText(
            "Permiso bloqueado. Puedes habilitarlo en los ajustes del navegador.",
            { exact: true },
          )
          .waitFor();
        await page
          .getByRole("dialog")
          .getByRole("button", { name: "Cerrar", exact: true })
          .click();
        await page.evaluate(() => {
          delete window.Notification;
        });
        await openSettings(page);
        await page
          .getByText("Push no está disponible en este navegador o conexión.", {
            exact: true,
          })
          .waitFor();
        assert.deepEqual(errors, []);
        await context.close();
      } finally {
        await browser.close();
      }
    },
  );
}
