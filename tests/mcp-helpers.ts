import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { getAuth } from "../src/server/auth";
import { createMcpEndpoint } from "../src/server/mcp/http";
import type { PostgresRepository } from "../src/server/postgres";
import { addUser, authConfig, createRepository, mockOAuth } from "./helpers";
import { oauthAuthorize } from "./oauth-helpers";

export const base = authConfig.BETTER_AUTH_URL;
export const MCP_URL = `${base}/api/mcp`;
export const FULL_SCOPES = ["taskode:read", "taskode:write", "taskode:admin", "offline_access"];
type Text = { type: string; text?: string };
export const textOf = (result: { content?: unknown }) =>
  ((result.content ?? []) as Text[]).map((item) => item.text ?? "").join("\n");

// Repository + global auth + in-process JWKS + an MCP endpoint whose side effects are recorded.
export async function mcpFixture() {
  const repo = await createRepository();
  const old = { ...process.env };
  const attachments = await mkdtemp(join(tmpdir(), "taskode-mcp-"));
  Object.assign(globalThis, { taskodeRepository: repo });
  Object.assign(process.env, authConfig, {
    ABLY_API_KEY: "",
    MCP_ALLOWED_ORIGINS: "http://localhost:6274",
    ATTACHMENT_STORAGE: "filesystem",
    ATTACHMENT_DIR: attachments,
    // Each fixture has its own signing keys; a distinct URL keeps the JWKS cache per fixture.
    MCP_JWKS_URL: `${base}/api/auth/jwks?fixture=${randomUUID()}`,
  });
  const bundle = getAuth();
  await mockOAuth(bundle);
  const realFetch = globalThis.fetch;
  // The resource server fetches /api/auth/jwks over HTTP; serve it from the in-process handler.
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.startsWith(`${base}/api/auth/`)) return bundle.handle(new Request(input, init));
    return realFetch(input, init);
  }) as typeof fetch;
  const effects = { notifications: 0, comments: 0, workspace: 0 };
  const endpoint = createMcpEndpoint({
    effects: { notifications: () => void effects.notifications++, comments: () => void effects.comments++, workspace: () => void effects.workspace++ },
  });
  const clients: Client[] = [];
  async function token(email = "test-admin@example.com", scopes = FULL_SCOPES) {
    const result = await oauthAuthorize(bundle, {
      email,
      scopes,
      consentScopes: scopes,
    });
    if (!result.access_token) throw new Error(`sin token para ${email}`);
    return result;
  }
  async function connect(accessToken: string) {
    const client = new Client({ name: "taskode-test", version: "1.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(MCP_URL), {
        fetch: (url, init) => endpoint.handle(new Request(url, init)),
        requestInit: { headers: { Authorization: `Bearer ${accessToken}` } },
      }),
    );
    clients.push(client);
    return client;
  }
  async function member(id: string) {
    await addUser(repo, id);
    return `${id}@example.com`;
  }
  async function close() {
    for (const client of clients) await client.close().catch(() => {});
    globalThis.fetch = realFetch;
    for (const key of Object.keys(process.env)) if (!(key in old)) delete process.env[key];
    Object.assign(process.env, old);
    Reflect.deleteProperty(globalThis, "taskodeRepository");
    Reflect.deleteProperty(globalThis, "taskodeAuth");
    await repo.close();
    await rm(attachments, { recursive: true, force: true });
  }
  return { repo: repo as PostgresRepository, bundle, endpoint, effects, token, connect, member, close };
}
export async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  return { ...result, text: textOf(result), error: Boolean(result.isError) };
}
