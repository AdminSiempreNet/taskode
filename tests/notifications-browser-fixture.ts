// Interactive QA: node --import tsx tests/notifications-browser-fixture.ts
// Uses an isolated test database; type "stop" on stdin to clean up.
import { startHttpFixture } from "./http-fixture";
import { addUser, actor, authConfig } from "./helpers";
import { session } from "../src/server/schema";
import { randomUUID } from "node:crypto";
import { serializeSignedCookie } from "better-call";
import { mkdir, writeFile } from "node:fs/promises";

async function main() {
  const f = await startHttpFixture(true);
  const member = await addUser(f.repo, "qa-member");
  const projectId = (
    await f.repo.execute(
      {
        type: "project.create",
        name: "Lanzamiento Taskode",
        description: "",
        icon: "🚀",
        color: "#059669",
      },
      actor,
    )
  ).createdId!;
  await f.repo.execute(
    { type: "project.team.add", projectId, userId: member.id },
    actor,
  );
  const w = await f.repo.getWorkspace(actor);
  const taskId = (
    await f.repo.execute(
      {
        type: "task.create",
        projectId,
        featureId: w.features[0].id,
        statusId: w.statuses[0].id,
        title: "Preparar la próxima entrega",
        description: "Verificar notificaciones y recordatorios.",
        priority: "medium",
        dueDate: "2099-10-20",
        dueTime: "10:00",
        labels: [],
        leaderId: member.id,
      },
      actor,
    )
  ).createdId!;
  const now = new Date(),
    token = randomUUID();
  await f.repo.store.db
    .insert(session)
    .values({
      id: randomUUID(),
      userId: member.id,
      token,
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(Date.now() + 86400000),
    });
  const memberCookie = (
    await serializeSignedCookie(
      "better-auth.session_token",
      token,
      authConfig.BETTER_AUTH_SECRET,
      { path: "/" },
    )
  ).split(";")[0];
  await mkdir("test-results", { recursive: true });
  await writeFile(
    "test-results/notifications-browser.json",
    JSON.stringify({
      base: f.base,
      adminCookie: f.cookie,
      memberCookie,
      projectId,
      taskId,
    }),
  );
  console.log(
    `QA listo: ${f.base}/notifications. Sesiones de prueba en test-results/notifications-browser.json`,
  );
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", async (data) => {
    if (String(data).trim() === "stop") {
      await f.stop();
      process.exit(0);
    }
  });
  process.on("SIGTERM", async () => {
    await f.stop();
    process.exit(0);
  });
}
main().catch(() => {
  console.error("No se pudo iniciar la sesión de QA.");
  process.exitCode = 1;
});
