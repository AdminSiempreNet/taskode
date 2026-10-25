// Explicit opt-in command. Uses a disposable *_test schema and the real Ably
// development namespace: one person moves a task, another sees it without reloading.
import nextEnv from "@next/env";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { serializeSignedCookie } from "better-call";
import { ablyConfig } from "../src/server/realtime-config.ts";

nextEnv.loadEnvConfig(process.cwd(), true);
// Fixtures clear provider credentials; capture them first and never print them.
const config = ablyConfig();

test(
  "navegador + Ably real: un movimiento ajeno actualiza el tablero y el detalle abiertos",
  { timeout: 120_000 },
  async () => {
    assert.ok(config, "Configura ABLY_API_KEY en .env.local.");
    assert.equal(config.namespace, "taskode-development", "La prueba real solo usa el espacio de desarrollo.");
    const { startHttpFixture } = await import("./http-fixture.ts");
    const { actor, addUser, authConfig } = await import("./helpers.ts");
    const { session } = await import("../src/server/schema.ts");
    const f = await startHttpFixture(false, { ably: config });
    const browser = await chromium.launch({ headless: true });
    try {
      await mkdir("test-results", { recursive: true });
      const projectId = (await f.repo.execute({ type: "project.create", name: "Tablero en vivo", description: "", icon: "T", color: "#3b82f6" }, actor)).createdId;
      const member = await addUser(f.repo, `board-${randomUUID()}`);
      await f.repo.execute({ type: "project.team.add", projectId, userId: member.id }, actor);
      const w = await f.repo.getWorkspace(actor);
      const [todo, doing, review] = w.statuses.filter((s) => s.projectId === projectId);
      const taskId = (await f.repo.execute({
        type: "task.create", projectId, featureId: w.features.find((x) => x.projectId === projectId).id,
        statusId: todo.id, priority: "medium", title: "Tarea en vivo", description: "", dueDate: null, labels: [],
        leaderId: actor.id, teamMemberIds: [member.id],
      }, actor)).createdId;
      const token = randomUUID(), now = new Date();
      await f.repo.store.db.insert(session).values({ id: randomUUID(), token, userId: member.id, createdAt: now, updatedAt: now, expiresAt: new Date(Date.now() + 600_000) });
      const memberCookie = (await serializeSignedCookie("better-auth.session_token", token, authConfig.BETTER_AUTH_SECRET, { path: "/" })).split(";")[0];

      const open = async (cookie, path) => {
        const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
        const split = cookie.indexOf("=");
        await context.addCookies([{ name: cookie.slice(0, split), value: cookie.slice(split + 1), url: f.base }]);
        const page = await context.newPage(), errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.setDefaultTimeout(15_000);
        // The Ably socket opens once the notifications client gets its channel.
        const socket = page.waitForEvent("websocket", { predicate: (ws) => /ably/.test(ws.url()), timeout: 20_000 });
        await page.goto(`${f.base}${path}`);
        await (await socket).waitForEvent("framereceived", { timeout: 20_000 });
        return { page, errors };
      };
      const move = (page, statusId) =>
        page.evaluate(async ({ id, statusId }) => {
          const r = await fetch("/api/workspace", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "task.move", id, statusId, beforeId: null }) });
          return r.status;
        }, { id: taskId, statusId });
      const card = (page, status) =>
        page.getByRole("region", { name: `Columna ${status.name}` }).getByRole("button", { name: "Abrir tarea: Tarea en vivo" });

      const admin = await open(f.cookie, `/projects/${projectId}`);
      const viewer = await open(memberCookie, `/projects/${projectId}`);
      await card(viewer.page, todo).waitFor();
      // Give the subscription a moment to attach after the socket's first frame.
      await viewer.page.waitForTimeout(1500);

      assert.equal(await move(admin.page, doing.id), 200);
      await card(viewer.page, doing).waitFor({ timeout: 10_000 });
      assert.equal(await card(viewer.page, todo).count(), 0, "la tarjeta sale de la columna anterior");
      await viewer.page.screenshot({ path: "test-results/workspace-realtime-board.png" });

      // The open task detail adopts the remote status and does not report unsaved changes.
      await viewer.page.goto(`${f.base}/projects/${projectId}/tasks/${taskId}?tab=properties`);
      await viewer.page.locator("#task-status").waitFor();
      await viewer.page.waitForTimeout(2500);
      assert.equal(await move(admin.page, review.id), 200);
      await viewer.page.locator("#task-status", { hasText: review.name }).waitFor({ timeout: 10_000 });
      assert.equal(await viewer.page.locator(".save-pending-dot").count(), 0, "el cambio ajeno no aparece como cambio sin guardar");
      await viewer.page.screenshot({ path: "test-results/workspace-realtime-detail.png" });

      assert.deepEqual([...admin.errors, ...viewer.errors], []);
    } finally {
      await browser.close();
      await f.stop();
    }
  },
);
