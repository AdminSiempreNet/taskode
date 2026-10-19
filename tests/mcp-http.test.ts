import { test } from "node:test";
import assert from "node:assert/strict";
import { OAuthConnections } from "../src/server/oauth-connections";
import { refreshTokens } from "./oauth-helpers";
import { call, MCP_URL, mcpFixture } from "./mcp-helpers";

const listRequest = (headers: Record<string, string> = {}) =>
  new Request(MCP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });

test("MCP: sin token responde 401 con desafío RFC 9728 y con token lista y ejecuta herramientas", async () => {
  const fixture = await mcpFixture();
  try {
    const anonymous = await fixture.endpoint.handle(listRequest());
    assert.equal(anonymous.status, 401);
    const challenge = anonymous.headers.get("www-authenticate") ?? "";
    assert.match(challenge, /resource_metadata="http:\/\/localhost:5010\/\.well-known\/oauth-protected-resource\/api\/mcp"/);
    assert.match(challenge, /taskode:read/);
    assert.match(challenge, /offline_access/);
    const forged = await fixture.endpoint.handle(listRequest({ Authorization: "Bearer eyJhbGciOiJub25lIn0.eyJzdWIiOiJ0ZXN0LWFkbWluIn0." }));
    assert.equal(forged.status, 401);
    const { access_token } = await fixture.token();
    const client = await fixture.connect(access_token);
    const tools = (await client.listTools()).tools.map((tool) => tool.name);
    for (const name of ["get_me", "search_tasks", "create_task", "delete_item", "admin_list_users"])
      assert.ok(tools.includes(name), `${name} en ${tools.join(",")}`);
    for (const name of ["backup", "trello", "restore"])
      assert.ok(!tools.some((tool) => tool.includes(name)), `sin ${name}`);
    const me = await call(client, "get_me");
    assert.equal(me.error, false, me.text);
    assert.match(me.text, /test-admin/);
  } finally {
    await fixture.close();
  }
});

test("MCP: las herramientas visibles dependen de los permisos concedidos y del rol", async () => {
  const fixture = await mcpFixture();
  try {
    const readOnly = await fixture.connect((await fixture.token(undefined, ["taskode:read"])).access_token);
    const readTools = (await readOnly.listTools()).tools;
    assert.ok(readTools.length > 5);
    assert.ok(readTools.every((tool) => tool.annotations?.readOnlyHint === true), "solo lectura");
    const memberEmail = await fixture.member("mcp-member");
    const member = await fixture.connect(
      (await fixture.token(memberEmail, ["taskode:read", "taskode:write", "taskode:admin"])).access_token,
    );
    const memberTools = (await member.listTools()).tools.map((tool) => tool.name);
    assert.ok(memberTools.includes("create_task"));
    assert.ok(!memberTools.some((tool) => tool.startsWith("admin_")), "un miembro nunca ve herramientas de administración");
    const destructive = (await member.listTools()).tools.find((tool) => tool.name === "delete_item");
    assert.equal(destructive?.annotations?.destructiveHint, true);
    const noRead = await fixture.token(undefined, ["openid"]);
    const insufficient = await fixture.endpoint.handle(listRequest({ Authorization: `Bearer ${noRead.access_token}` }));
    assert.equal(insufficient.status, 403);
    assert.match(insufficient.headers.get("www-authenticate") ?? "", /insufficient_scope/);
  } finally {
    await fixture.close();
  }
});

test("MCP: valida el Origin, responde a CORS permitido y la revocación surte efecto al instante", async () => {
  const fixture = await mcpFixture();
  try {
    const tokens = await fixture.token();
    const auth = { Authorization: `Bearer ${tokens.access_token}` };
    const foreign = await fixture.endpoint.handle(listRequest({ ...auth, Origin: "https://malicioso.example" }));
    assert.equal(foreign.status, 403);
    const preflight = fixture.endpoint.options(
      new Request(MCP_URL, { method: "OPTIONS", headers: { Origin: "http://localhost:6274" } }),
    );
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), "http://localhost:6274");
    assert.match(preflight.headers.get("access-control-allow-headers") ?? "", /authorization/);
    const client = await fixture.connect(tokens.access_token);
    assert.equal((await call(client, "get_me")).error, false);
    const connections = new OAuthConnections(fixture.repo);
    const [app] = await connections.list({ id: "test-admin" });
    assert.equal(app.clientId, tokens.client);
    assert.ok(app.lastUsedAt === null || typeof app.lastUsedAt === "string");
    await connections.revoke({ id: "test-admin" }, tokens.client);
    const after = await fixture.endpoint.handle(listRequest(auth));
    assert.equal(after.status, 401);
    assert.match(after.headers.get("www-authenticate") ?? "", /invalid_token/);
    const refreshed = await refreshTokens(fixture.bundle, tokens.client, tokens.refresh_token!);
    assert.notEqual(refreshed.status, 200, "el refresh token quedó revocado");
    assert.deepEqual(await connections.list({ id: "test-admin" }), []);
  } finally {
    await fixture.close();
  }
});
