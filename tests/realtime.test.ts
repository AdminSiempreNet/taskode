import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { jwtVerify } from "jose";
import {
  actor,
  addUser,
  authConfig,
  authenticatedRequest,
  createRepository,
} from "./helpers";
import { commentOutbox } from "../src/server/schema";
import { flushCommentEvents } from "../src/server/realtime";
import { ablyConfig, commentsChannel } from "../src/server/realtime-config";
import { POST as tokenRoute } from "../src/app/api/tasks/[id]/comments/token/route";
import { PostgresRepository } from "../src/server/postgres";

async function fixture() {
  const repo = await createRepository();
  const owner = await addUser(repo, "owner"),
    leader = await addUser(repo, "leader"),
    member = await addUser(repo, "member"),
    other = await addUser(repo, "other");
  const projectId = (
    await repo.execute(
      {
        type: "project.create",
        name: "Chat",
        description: "",
        icon: "C",
        color: "#059669",
      },
      owner,
    )
  ).createdId!;
  for (const person of [leader, member, other])
    await repo.execute(
      { type: "project.team.add", projectId, userId: person.id },
      owner,
    );
  const workspace = await repo.getWorkspace(owner);
  const fields = {
    projectId,
    featureId: workspace.features[0].id,
    statusId: workspace.statuses[0].id,
    title: "Privada",
    description: "",
    priority: "medium",
    dueDate: null,
    labels: [],
    leaderId: leader.id,
    teamMemberIds: [member.id],
  };
  const taskId = (await repo.execute({ type: "task.create", ...fields }, owner))
    .createdId!;
  return { repo, owner, leader, member, other, taskId, fields };
}

test("realtime: crear, editar y borrar encolan en la misma transacción; un rollback no emite avisos", async () => {
  const f = await fixture();
  try {
    const id = (
      await f.repo.execute(
        { type: "comment.create", taskId: f.taskId, content: "Uno" },
        f.member,
      )
    ).createdId!;
    const first = (await f.repo.store.db.select().from(commentOutbox))[0];
    assert.equal(first.taskId, f.taskId);
    await f.repo.execute(
      { type: "comment.update", id, content: "Dos" },
      f.member,
    );
    const second = (await f.repo.store.db.select().from(commentOutbox))[0];
    assert.notEqual(first.eventId, second.eventId);
    await assert.rejects(
      f.repo.execute(
        {
          type: "comment.create",
          taskId: f.taskId,
          content:
            "![x](/api/files/00000000-0000-4000-8000-000000000000/content)",
        },
        f.member,
      ),
    );
    assert.equal(
      (await f.repo.store.db.select().from(commentOutbox))[0].eventId,
      second.eventId,
    );
    await f.repo.execute({ type: "comment.delete", id }, f.member);
    assert.equal(
      (await f.repo.store.db.select().from(commentOutbox)).length,
      1,
    );
    assert.notEqual(
      (await f.repo.store.db.select().from(commentOutbox))[0].eventId,
      second.eventId,
    );
    assert.deepEqual(
      (await f.repo.taskComments(f.member, f.taskId)).comments,
      [],
    );
  } finally {
    await f.repo.close();
  }
});

test("realtime: duplicar un envío no crea otro mensaje ni permite reutilizar IDs ajenos", async () => {
  const f = await fixture();
  try {
    const command = {
      type: "comment.create" as const,
      taskId: f.taskId,
      content: "Hola",
      requestId: randomUUID(),
    };
    const results = await Promise.all([
      f.repo.execute(command, f.member),
      f.repo.execute(command, f.member),
    ]);
    assert.equal(results[0].createdId, results[1].createdId);
    assert.equal(
      (await f.repo.taskComments(f.member, f.taskId)).comments.length,
      1,
    );
    await assert.rejects(f.repo.execute(command, f.leader), { status: 409 });
    const otherTask = (
      await f.repo.execute({ type: "task.create", ...f.fields }, f.owner)
    ).createdId!;
    await assert.rejects(
      f.repo.executeComment(f.member, otherTask, {
        type: "comment.delete",
        id: results[0].createdId!,
      }),
      { status: 404 },
    );
    await assert.rejects(f.repo.executeComment(f.other, f.taskId, command), {
      status: 404,
    });
  } finally {
    await f.repo.close();
  }
});

test("realtime: el fanout reevalúa acceso; un miembro retirado no recibe más avisos", async () => {
  const f = await fixture();
  try {
    await f.repo.execute(
      { type: "comment.create", taskId: f.taskId, content: "Secreto" },
      f.member,
    );
    assert.deepEqual(
      (await f.repo.commentRecipients(f.taskId)).sort(),
      [actor.id, f.owner.id, f.leader.id, f.member.id].sort(),
    );
    await f.repo.execute(
      {
        type: "task.assignment.update",
        id: f.taskId,
        leaderId: f.leader.id,
        teamMemberIds: [],
      },
      f.owner,
    );
    const events: unknown[] = [];
    const result = await flushCommentEvents(
      f.repo,
      async (event, recipients) => {
        events.push(event);
        assert.ok(!recipients.includes(f.member.id));
        assert.ok(!recipients.includes(f.other.id));
      },
    );
    assert.deepEqual(result, { sent: 1, failed: 0 });
    assert.deepEqual(Object.keys(events[0] as object).sort(), [
      "eventId",
      "taskId",
    ]);
    assert.equal(
      (await f.repo.store.db.select().from(commentOutbox)).length,
      0,
    );
  } finally {
    await f.repo.close();
  }
});

test("realtime: un fallo de Ably conserva el aviso y una edición durante el envío no se pierde", async () => {
  const f = await fixture();
  try {
    const id = (
      await f.repo.execute(
        { type: "comment.create", taskId: f.taskId, content: "Uno" },
        f.member,
      )
    ).createdId!;
    assert.deepEqual(
      await flushCommentEvents(f.repo, async () => {
        throw new Error("red");
      }),
      { sent: 0, failed: 1 },
    );
    const failed = (await f.repo.store.db.select().from(commentOutbox))[0];
    assert.equal(failed.attempts, 1);
    assert.equal(failed.leaseUntil, null);
    await f.repo.store.db
      .update(commentOutbox)
      .set({ availableAt: new Date(0) });
    await flushCommentEvents(f.repo, async () => {
      await f.repo.execute(
        { type: "comment.update", id, content: "Dos" },
        f.member,
      );
    });
    assert.notEqual(
      (await f.repo.store.db.select().from(commentOutbox))[0].eventId,
      failed.eventId,
    );
    assert.deepEqual(await flushCommentEvents(f.repo, async () => {}), {
      sent: 1,
      failed: 0,
    });
  } finally {
    await f.repo.close();
  }
});

test("realtime: dos instancias no reclaman el mismo aviso y las tareas eliminadas se limpian", async () => {
  const f = await fixture();
  const second = new PostgresRepository(f.repo.store.connectionString, { schema: f.repo.store.schemaName, max: 3 });
  try {
    await f.repo.execute(
      { type: "comment.create", taskId: f.taskId, content: "Uno" },
      f.member,
    );
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started!: () => void;
    const publishing = new Promise<void>((resolve) => {
      started = resolve;
    });
    const first = flushCommentEvents(f.repo, async () => {
      started();
      await gate;
    });
    await publishing;
    assert.deepEqual(
      await flushCommentEvents(second, async () => {
        assert.fail("Reclamación duplicada");
      }),
      { sent: 0, failed: 0 },
    );
    release();
    await first;
    await f.repo.execute({ type: "task.delete", id: f.taskId }, f.owner);
    assert.deepEqual(await f.repo.commentRecipients(f.taskId), []);
    await flushCommentEvents(f.repo, async (_event, recipients) => {
      assert.deepEqual(recipients, []);
    });
    assert.equal(
      (await f.repo.store.db.select().from(commentOutbox)).length,
      0,
    );
  } finally {
    await second.close();
    await f.repo.close();
  }
});

test("realtime: el endpoint solo firma JWT de lectura para la tarea y el usuario autorizados", async () => {
  const f = await fixture();
  const old = { ...process.env };
  const globalRepo = globalThis as typeof globalThis & {
    taskodeRepository?: PostgresRepository;
  };
  try {
    Object.assign(process.env, authConfig, {
      ABLY_API_KEY: "test.key:secret",
      ABLY_CHANNEL_NAMESPACE: "taskode-development",
    });
    globalRepo.taskodeRepository = f.repo;
    const context = { params: Promise.resolve({ id: f.taskId }) };
    const url = `http://localhost:5010/api/tasks/${f.taskId}/comments/token`;
    assert.equal(
      (await tokenRoute(new Request(url, { method: "POST" }), context)).status,
      401,
    );
    assert.equal(
      (
        await tokenRoute(
          await authenticatedRequest(url, { method: "POST" }, f.other.id),
          context,
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await tokenRoute(
          await authenticatedRequest(
            url,
            { method: "POST", headers: { Origin: "https://attacker.example" } },
            f.member.id,
          ),
          context,
        )
      ).status,
      403,
    );
    const response = await tokenRoute(
      await authenticatedRequest(url, { method: "POST" }, f.member.id),
      context,
    );
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control")!, /no-store/);
    const token = await response.text();
    const { payload, protectedHeader } = await jwtVerify(
      token,
      new TextEncoder().encode("secret"),
      { algorithms: ["HS256"] },
    );
    assert.equal(protectedHeader.kid, "test.key");
    assert.equal(payload["x-ably-clientId"], f.member.id);
    assert.equal(payload.exp! - payload.iat!, 600);
    assert.deepEqual(JSON.parse(String(payload["x-ably-capability"])), {
      [commentsChannel("taskode-development", f.taskId, f.member.id)]: [
        "subscribe",
      ],
    });
    assert.ok(!token.includes("secret"));
    await f.repo.execute(
      {
        type: "task.assignment.update",
        id: f.taskId,
        leaderId: f.leader.id,
        teamMemberIds: [],
      },
      f.owner,
    );
    assert.equal(
      (
        await tokenRoute(
          await authenticatedRequest(url, { method: "POST" }, f.member.id),
          context,
        )
      ).status,
      404,
    );
  } finally {
    delete globalRepo.taskodeRepository;
    for (const key of Object.keys(process.env))
      if (!(key in old)) delete process.env[key];
    Object.assign(process.env, old);
    await f.repo.close();
  }
});

test("realtime: valida configuración y protege el nombre del canal contra comodines", () => {
  assert.equal(ablyConfig({}), null);
  assert.throws(
    () => ablyConfig({ ABLY_API_KEY: "invalid" }),
    /API key completa/,
  );
  assert.throws(
    () =>
      ablyConfig({
        ABLY_API_KEY: "test.key:secret",
        ABLY_CHANNEL_NAMESPACE: "taskode:*",
      }),
    /ABLY_CHANNEL_NAMESPACE/,
  );
  const channel = commentsChannel(
    "taskode-development",
    "*:task",
    "other:*:user",
  );
  assert.ok(!channel.includes("*"));
  assert.notEqual(
    channel,
    commentsChannel("taskode-development", "task", "user"),
  );
});
