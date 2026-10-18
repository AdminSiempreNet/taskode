import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TaskCommentsClient,
  type ChatConnection,
} from "../src/lib/task-comments-client";
import type { TaskComment } from "../src/lib/types";

const user = { id: "user", name: "Persona", image: null };
const note = (id: string, content = id): TaskComment => ({
  id,
  taskId: "task",
  content,
  authorId: "user",
  author: user,
  createdAt: "2026-10-17T12:00:00Z",
  updatedAt: "2026-10-17T12:00:00Z",
});
const snapshot = (comments: TaskComment[], channel: string | null = null) =>
  Response.json({
    comments,
    permissions: {
      canEdit: true,
      canManageAccess: false,
      canDelete: false,
      canModerateComments: false,
    },
    realtime: { enabled: !!channel, channel },
  });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test("chat: fetch nativo conserva el contexto global al consultar y enviar", async (t) => {
  let reads = 0, writes = 0;
  t.mock.method(globalThis, "fetch", function (this: typeof globalThis, _url: Parameters<typeof fetch>[0], init?: RequestInit) {
    // Browsers reject calling native fetch with the controller as its receiver.
    if (this !== globalThis) throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
    if (init?.method === "POST") writes++;
    else reads++;
    return Promise.resolve(snapshot([note("native")]));
  });
  const client = new TaskCommentsClient("task", [], user, () => {});
  try {
    await client.refresh();
    assert.equal(client.state.connection, "polling");
    assert.equal(client.state.comments[0]?.id, "native");
    assert.ok(await client.mutate({ type: "comment.create", content: "Hola" }));
    assert.equal(client.state.error, "");
    assert.equal(writes, 1);
    assert.ok(reads > 0);
  } finally { client.stop(); }
});

test("chat: un aviso remoto sincroniza altas, ediciones y eliminaciones sin duplicar conexiones", async () => {
  let comments = [note("one")],
    notify!: () => void,
    connects = 0,
    disconnects = 0;
  const client = new TaskCommentsClient("task", [], user, () => {}, {
    fetch: async () => snapshot(comments, "private"),
    connect: async (_channel, changed, status) => {
      connects++;
      notify = changed;
      status("live");
      return () => {
        disconnects++;
      };
    },
  });
  try {
    await client.refresh();
    assert.equal(client.state.connection, "live");
    comments = [note("one", "editado"), note("two")];
    notify();
    await tick();
    assert.deepEqual(client.state.comments, comments);
    comments = [note("two")];
    notify();
    await tick();
    assert.deepEqual(client.state.comments, comments);
    assert.equal(connects, 1);
  } finally {
    client.stop();
  }
  assert.equal(disconnects, 1);
});

test("chat: una lectura iniciada antes de enviar no puede borrar el mensaje confirmado", async () => {
  const oldRead = deferred<Response>();
  let gets = 0;
  const client = new TaskCommentsClient("task", [], user, () => {}, {
    fetch: async (_url, init) =>
      init?.method === "POST"
        ? snapshot([note("new")])
        : ++gets === 1
          ? oldRead.promise
          : snapshot([note("new")]),
  });
  try {
    const reading = client.refresh();
    await client.mutate({ type: "comment.create", content: "nuevo" });
    assert.equal(client.state.comments[0].id, "new");
    oldRead.resolve(snapshot([]));
    await reading;
    assert.equal(client.state.comments[0].id, "new");
    assert.equal(client.state.pending, null);
  } finally {
    client.stop();
  }
});

test("chat: los reintentos de un envío incierto conservan su ID", async () => {
  const bodies: { requestId: string }[] = [];
  const client = new TaskCommentsClient("task", [], user, () => {}, {
    fetch: async (_url, init) => {
      if (init?.method !== "POST") return snapshot([]);
      bodies.push(JSON.parse(String(init.body)));
      if (bodies.length === 1) throw new Error("Sin conexión");
      return snapshot([note(bodies[1].requestId)]);
    },
  });
  try {
    assert.equal(
      await client.mutate({ type: "comment.create", content: "hola" }),
      null,
    );
    assert.match(client.state.error, /Sin conexión/);
    assert.equal(client.state.sending, false);
    assert.ok(await client.mutate({ type: "comment.create", content: "hola" }));
    assert.equal(bodies[0].requestId, bodies[1].requestId);
  } finally {
    client.stop();
  }
});

test("chat: perder acceso limpia la conversación y desactiva las escrituras", async () => {
  const client = new TaskCommentsClient("task", [note("one")], user, () => {}, {
    fetch: async () => Response.json({ error: "Sin acceso" }, { status: 404 }),
  });
  try {
    await client.refresh();
    assert.equal(client.state.connection, "denied");
    assert.deepEqual(client.state.comments, []);
    assert.equal(
      await client.mutate({ type: "comment.create", content: "hola" }),
      null,
    );
  } finally {
    client.stop();
  }
});

test("chat: cerrar la tarea cancela respuestas tardías y libera la suscripción", async () => {
  const pending = deferred<Response>();
  let changes = 0;
  const client = new TaskCommentsClient(
    "task",
    [],
    user,
    () => {
      changes++;
    },
    { fetch: async () => pending.promise },
  );
  const refresh = client.refresh();
  client.stop();
  pending.resolve(snapshot([note("late")]));
  await refresh;
  assert.equal(changes, 0);
});

test("chat: una desconexión mantiene mensajes y una reconexión recupera el estado completo", async () => {
  let status!: (connection: ChatConnection) => void,
    notify!: () => void,
    comments = [note("one")];
  const client = new TaskCommentsClient("task", [], user, () => {}, {
    fetch: async () => snapshot(comments, "private"),
    connect: async (_channel, changed, state) => {
      notify = changed;
      status = state;
      state("live");
      return () => {};
    },
  });
  try {
    await client.refresh();
    status("offline");
    assert.equal(client.state.comments.length, 1);
    comments = [note("one", "editado"), note("missed")];
    status("live");
    notify();
    await tick();
    assert.deepEqual(client.state.comments, comments);
  } finally {
    client.stop();
  }
});
