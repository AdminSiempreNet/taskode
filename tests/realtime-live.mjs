// Explicit opt-in command. Uses a disposable *_test schema and real Ably transport.
import nextEnv from "@next/env";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { serializeSignedCookie } from "better-call";
import { ablyConfig } from "../src/server/realtime-config.ts";
import { TaskCommentsClient } from "../src/lib/task-comments-client.ts";

nextEnv.loadEnvConfig(process.cwd(), true);
// Fixtures clear provider credentials for the ordinary suite. Capture only for
// this opt-in run, before importing them; never write or print these values.
const config = ablyConfig();

test(
  "Ably real: dos sesiones sincronizan mensajes, ediciones y borrados con permisos",
  { timeout: 90_000 },
  async () => {
    assert.ok(config, "Configura ABLY_API_KEY en .env.local.");
    assert.equal(
      config.namespace,
      "taskode-development",
      "La prueba real solo usa el espacio de desarrollo.",
    );
    const { startHttpFixture } = await import("./http-fixture.ts");
    const { actor, addUser, authConfig } = await import("./helpers.ts");
    const { session } = await import("../src/server/schema.ts");
    const fixture = await startHttpFixture(false, { ably: config });
    let first, second;
    const request =
      (cookie) =>
      (url, init = {}) => {
        const headers = new Headers(init.headers);
        headers.set("Cookie", cookie);
        return fetch(new URL(url, fixture.base), { ...init, headers });
      };
    const adminFetch = request(fixture.cookie);
    const send = async (command) => {
      const response = await adminFetch("/api/workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(command),
      });
      const body = await response.json();
      assert.equal(response.status, 200, JSON.stringify(body));
      return body;
    };
    const waitFor = async (condition) => {
      const deadline = Date.now() + 15_000;
      while (!condition()) {
        if (Date.now() > deadline)
          assert.fail("La sincronización no llegó a tiempo.");
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    };
    try {
      const member = await addUser(fixture.repo, `realtime-${randomUUID()}`);
      const project = await send({
        type: "project.create",
        name: "Prueba aislada realtime",
        description: "",
        icon: "C",
        color: "#059669",
      });
      await send({
        type: "project.team.add",
        projectId: project.createdId,
        userId: member.id,
      });
      const taskId = (
        await send({
          type: "task.create",
          projectId: project.createdId,
          featureId: project.workspace.features[0].id,
          statusId: project.workspace.statuses[0].id,
          title: "Chat de prueba",
          description: "",
          priority: "medium",
          dueDate: null,
          teamMemberIds: [member.id],
        })
      ).createdId;
      const token = randomUUID(),
        now = new Date();
      await fixture.repo.store.db
        .insert(session)
        .values({
          id: randomUUID(),
          token,
          userId: member.id,
          createdAt: now,
          updatedAt: now,
          expiresAt: new Date(Date.now() + 60_000),
        });
      const memberCookie = (
        await serializeSignedCookie(
          "better-auth.session_token",
          token,
          authConfig.BETTER_AUTH_SECRET,
          { path: "/" },
        )
      ).split(";")[0];
      const memberFetch = request(memberCookie);
      first = new TaskCommentsClient(
        taskId,
        [],
        { id: actor.id, name: "Admin de prueba", image: null },
        () => {},
        { fetch: adminFetch, visible: () => true },
      );
      second = new TaskCommentsClient(
        taskId,
        [],
        { id: member.id, name: "Miembro de prueba", image: null },
        () => {},
        { fetch: memberFetch, visible: () => true },
      );
      first.start();
      second.start();
      await waitFor(
        () =>
          first.state.connection === "live" &&
          second.state.connection === "live",
      );
      const created = await first.mutate({
        type: "comment.create",
        content: "Mensaje sintético A",
      });
      assert.ok(created);
      await waitFor(() =>
        second.state.comments.some(
          (comment) => comment.id === created.createdId,
        ),
      );
      assert.equal(second.state.comments[0].authorId, actor.id);
      assert.equal(
        await second.mutate({
          type: "comment.update",
          id: created.createdId,
          content: "No permitido",
        }),
        null,
      );
      await first.mutate({
        type: "comment.update",
        id: created.createdId,
        content: "Edición sintética",
      });
      await waitFor(() =>
        second.state.comments.some(
          (comment) => comment.content === "Edición sintética",
        ),
      );
      const reply = await second.mutate({
        type: "comment.create",
        content: "Respuesta sintética B",
      });
      assert.ok(reply);
      await waitFor(() =>
        first.state.comments.some((comment) => comment.id === reply.createdId),
      );
      await second.mutate({ type: "comment.delete", id: reply.createdId });
      await waitFor(
        () =>
          !first.state.comments.some(
            (comment) => comment.id === reply.createdId,
          ),
      );
      await send({
        type: "task.assignment.update",
        id: taskId,
        leaderId: actor.id,
        teamMemberIds: [],
      });
      await second.refresh();
      assert.equal(second.state.connection, "denied");
      assert.equal(
        (
          await memberFetch(`/api/tasks/${taskId}/comments/token`, {
            method: "POST",
          })
        ).status,
        404,
      );
      assert.equal(second.state.comments.length, 0);
      assert.equal(
        (await fixture.repo.taskComments(actor, taskId)).comments[0].content,
        "Edición sintética",
      );
    } finally {
      first?.stop();
      second?.stop();
      await fixture.stop();
    }
  },
);
