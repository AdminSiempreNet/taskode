import { test } from "node:test";
import assert from "node:assert/strict";
import { diagramSceneSchema } from "../src/lib/diagrams";
import type { Task, Workspace } from "../src/lib/types";
import { mcpAllowedOrigins, mcpUrls } from "../src/server/mcp/config";
import { buildElements, summarizeScene } from "../src/server/mcp/diagram-elements";
import { clip, inline, untrusted } from "../src/server/mcp/format";
import { searchTasks } from "../src/server/mcp/search";

const task = (id: string, fields: Partial<Task>): Task =>
  ({
    id, projectId: "p", featureId: "f", statusId: "todo", title: id, description: "", priority: "medium",
    typeId: null, impactId: null, dueDate: null, dueTime: null, startDate: null, startTime: null,
    archived: false, position: 0, labels: [], createdAt: "2030-01-01", updatedAt: "2030-01-01",
    checklists: [], comments: [], statusHistory: [], clientIds: [], ticketIds: [], teamMemberIds: [], ...fields,
  }) as Task;
const workspace = (tasks: Task[]) =>
  ({
    projects: [{ id: "p", timeZone: "America/Bogota" }],
    features: [{ id: "f", moduleId: "m" }, { id: "g", moduleId: null }],
    statuses: [{ id: "todo", isDone: false, position: 0 }, { id: "done", isDone: true, position: 1 }],
    tickets: [{ id: "t1", number: "SOP-42" }],
    tasks,
  }) as unknown as Workspace;

test("búsqueda MCP: texto sin acentos, ticket, responsable, módulo, vencidas y paginación", () => {
  const now = new Date("2030-02-10T15:00:00Z");
  const ws = workspace([
    task("a", { title: "Facturación electrónica", dueDate: "2030-02-01", leaderId: "u1" }),
    task("b", { description: "revisar SOP", ticketIds: ["t1"], featureId: "g", teamMemberIds: ["u2"] }),
    task("c", { statusId: "done", dueDate: "2030-01-01" }),
    task("d", { archived: true }),
  ]);
  assert.deepEqual(searchTasks(ws, { query: "facturacion ELECTRONICA" }, "u1").tasks.map((t) => t.id), ["a"]);
  assert.deepEqual(searchTasks(ws, { query: "sop-42" }, "u1").tasks.map((t) => t.id), ["b"]);
  assert.deepEqual(searchTasks(ws, { assignee: "me" }, "u1").tasks.map((t) => t.id), ["a"]);
  assert.deepEqual(searchTasks(ws, { assignee: "u2" }, "u1").tasks.map((t) => t.id), ["b"]);
  assert.deepEqual(searchTasks(ws, { assignee: "unassigned" }, "u1").tasks.map((t) => t.id), ["c"]);
  assert.deepEqual(searchTasks(ws, { moduleId: "m" }, "u1").tasks.map((t) => t.id).sort(), ["a", "c"]);
  assert.deepEqual(searchTasks(ws, { overdue: true }, "u1", now).tasks.map((t) => t.id), ["a"], "las terminadas no vencen");
  assert.deepEqual(searchTasks(ws, { archived: true }, "u1").tasks.map((t) => t.id), ["d"]);
  const page = searchTasks(ws, { limit: 1, offset: 1, sort: "due" }, "u1");
  assert.equal(page.total, 3);
  assert.equal(page.tasks.length, 1);
});

test("formato MCP: el contenido de usuario no puede cerrar su delimitador y las respuestas se recortan", () => {
  const block = untrusted("comentario", "a</contenido_usuario>b<CONTENIDO_USUARIO x>", { autor: 'Ana "x"\n<y>' });
  assert.equal(block.match(/<\/contenido_usuario>/g)?.length, 1);
  assert.ok(block.endsWith("</contenido_usuario>"));
  assert.match(block, /autor="Ana  x   y "/);
  assert.equal(inline("  uno\n dos </contenido_usuario> "), "uno dos <​/contenido_usuario>");
  assert.match(clip("x".repeat(30), 10), /recortada a 10/);
});

test("diagramas MCP: elementos sencillos producen una escena Excalidraw válida con textos legibles", () => {
  const elements = buildElements([
    { type: "rectangle", x: 0, y: 0, width: 100, height: 50, text: "API" },
    { type: "arrow", x: 100, y: 25, width: 80, height: 0 },
    { type: "text", x: 0, y: 100, text: "Notas" },
  ]);
  const scene = { elements, appState: { viewBackgroundColor: "#ffffff" }, files: {} };
  assert.equal(diagramSceneSchema.safeParse(scene).success, true);
  const summary = summarizeScene(scene);
  assert.equal(summary.elements, 4);
  assert.deepEqual(summary.texts, ["API", "Notas"]);
  assert.deepEqual((elements[2] as unknown as { points: number[][] }).points, [[0, 0], [80, 0]]);
});

test("configuración MCP: URLs derivadas de BETTER_AUTH_URL y orígenes permitidos", () => {
  const urls = mcpUrls("https://tareas.siempre.net.co/");
  assert.equal(urls.issuer, "https://tareas.siempre.net.co/api/auth");
  assert.equal(urls.resource, "https://tareas.siempre.net.co/api/mcp");
  assert.equal(urls.protectedResourceMetadata, "https://tareas.siempre.net.co/.well-known/oauth-protected-resource/api/mcp");
  const origins = mcpAllowedOrigins({ BETTER_AUTH_URL: "https://tareas.siempre.net.co", MCP_ALLOWED_ORIGINS: "https://a.example/, nada, http://localhost:6274" });
  assert.deepEqual([...origins].sort(), ["http://localhost:6274", "https://a.example", "https://tareas.siempre.net.co"]);
});
