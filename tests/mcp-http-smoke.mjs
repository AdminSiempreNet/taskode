import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { startHttpFixture } from "./http-fixture.ts";

// Real `next start` (run `npm run build` first): routing of /.well-known, the auth handler,
// the login/consent pages and the MCP endpoint, with a token obtained over HTTP.
let fixture, base;
before(async () => {
  fixture = await startHttpFixture();
  base = fixture.base;
});
after(async () => {
  await fixture?.stop();
});
const REDIRECT = "http://127.0.0.1:43123/callback";
// Browsers navigate (302). Node's fetch sends Sec-Fetch-Mode: cors, so Better Auth answers
// the same redirect as JSON { redirect, url }.
async function nextUrl(response) {
  const location = response.headers.get("location") ?? (await response.json()).url;
  assert.ok(location, `${response.status} sin redirección`);
  return new URL(location, base);
}

async function authorizeOverHttp(scopes) {
  const registered = await fetch(`${base}/api/auth/oauth2/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Smoke MCP",
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  });
  assert.ok(registered.ok, await registered.clone().text());
  assert.equal(registered.headers.get("access-control-allow-origin"), "*");
  const { client_id } = await registered.json();
  const verifier = randomBytes(32).toString("base64url");
  const params = new URLSearchParams({
    response_type: "code",
    client_id,
    redirect_uri: REDIRECT,
    scope: scopes.join(" "),
    state: "smoke",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    resource: `${base}/api/mcp`,
  });
  const anonymous = await fetch(`${base}/api/auth/oauth2/authorize?${params}`, { redirect: "manual", headers: { Accept: "text/html" } });
  const login = await nextUrl(anonymous);
  assert.equal(login.pathname, "/login");
  const loginPage = await fetch(login);
  assert.equal(loginPage.status, 200);
  assert.match(await loginPage.text(), /Conectar Smoke MCP/);
  assert.equal(loginPage.headers.get("x-frame-options"), "DENY");
  const authorized = await fetch(`${base}/api/auth/oauth2/authorize?${params}`, {
    redirect: "manual",
    headers: { Accept: "text/html", Cookie: fixture.cookie },
  });
  const consent = await nextUrl(authorized);
  assert.equal(consent.pathname, "/oauth/consent");
  const consentPage = await fetch(consent, { headers: { Cookie: fixture.cookie } });
  assert.equal(consentPage.status, 200);
  assert.match(await consentPage.text(), /Smoke MCP(<!-- -->)? quiere acceder a Taskode/);
  const accepted = await fetch(`${base}/api/auth/oauth2/consent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: fixture.cookie, Origin: base },
    body: JSON.stringify({ accept: true, scope: scopes.join(" "), oauth_query: consent.search.slice(1) }),
  });
  const { url } = await accepted.json();
  const code = new URL(url).searchParams.get("code");
  assert.ok(code, url);
  const token = await fetch(`${base}/api/auth/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT,
      client_id,
      code_verifier: verifier,
      resource: `${base}/api/mcp`,
    }),
  });
  assert.equal(token.status, 200, await token.clone().text());
  return token.json();
}

test("MCP HTTP: metadatos en la raíz, CORS, desafío 401 y páginas con la solicitud firmada", async () => {
  const prm = await fetch(`${base}/.well-known/oauth-protected-resource/api/mcp`);
  assert.equal(prm.status, 200);
  assert.equal(prm.headers.get("access-control-allow-origin"), "*");
  const resource = await prm.json();
  assert.equal(resource.resource, `${base}/api/mcp`);
  assert.deepEqual(resource.authorization_servers, [`${base}/api/auth`]);
  for (const path of [
    "/.well-known/oauth-authorization-server/api/auth",
    "/.well-known/oauth-authorization-server",
    "/.well-known/openid-configuration",
    "/api/auth/.well-known/openid-configuration",
  ]) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200, path);
    assert.equal((await response.json()).issuer, `${base}/api/auth`, path);
  }
  const preflight = await fetch(`${base}/api/auth/oauth2/token`, {
    method: "OPTIONS",
    headers: { Origin: "http://localhost:6274", "Access-Control-Request-Method": "POST" },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "*");
  assert.equal((await fetch(`${base}/api/auth/token`, { headers: { Cookie: fixture.cookie } })).status, 404);
  const anonymous = await fetch(`${base}/api/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  assert.equal(anonymous.status, 401);
  assert.match(anonymous.headers.get("www-authenticate") ?? "", /resource_metadata=/);
  const foreign = await fetch(`${base}/api/mcp`, { method: "OPTIONS", headers: { Origin: "https://malicioso.example" } });
  assert.equal(foreign.status, 403);
  const withCookie = await fetch(`${base}/api/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Cookie: fixture.cookie },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  assert.equal(withCookie.status, 401, "la cookie de sesión no autoriza el endpoint MCP");
  const tampered = await fetch(`${base}/login?sig=falsa&exp=1&client_id=x`, { redirect: "manual" });
  assert.match(tampered.headers.get("location") ?? "", /error=oauth_expired/);
});

test("MCP HTTP: token real por OAuth, herramientas y entrega de avisos tras la respuesta", async () => {
  const tokens = await authorizeOverHttp(["taskode:read", "taskode:write", "offline_access"]);
  assert.ok(tokens.refresh_token);
  const client = new Client({ name: "smoke", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/api/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${tokens.access_token}` } },
    }),
  );
  try {
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    assert.ok(names.includes("create_task"));
    assert.ok(!names.some((name) => name.startsWith("admin_")), "sin taskode:admin no hay herramientas de administración");
    const project = await client.callTool({ name: "create_entity", arguments: { kind: "project", name: "Smoke" } });
    assert.ok(!project.isError, JSON.stringify(project.content));
    const projectId = project.structuredContent.id;
    const feature = await client.callTool({ name: "create_entity", arguments: { kind: "feature", projectId, name: "General" } });
    const task = await client.callTool({
      name: "create_task",
      arguments: { projectId, featureId: feature.structuredContent.id, title: "Tarea desde MCP" },
    });
    assert.ok(!task.isError, JSON.stringify(task.content));
    const search = await client.callTool({ name: "search_tasks", arguments: { projectId } });
    assert.equal(search.structuredContent.total, 1);
    assert.doesNotMatch(fixture.logs(), /outside a request scope/);
  } finally {
    await client.close();
  }
});
