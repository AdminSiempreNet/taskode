import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeJwt } from "jose";
import { eq } from "drizzle-orm";
import { createProjectAuth, type AuthDependencies } from "../src/server/auth";
import { InvitationService } from "../src/server/invitations";
import { mcpUrls } from "../src/server/mcp/config";
import { wellKnownHandler } from "../src/server/mcp/well-known";
import * as schema from "../src/server/schema";
import {
  addUser,
  authConfig,
  authenticatedRequest,
  createEmptyRepository,
  createRepository,
  mockOAuth,
  oauthLogin,
} from "./helpers";
import { REDIRECT_URI, oauthAuthorize, refreshTokens } from "./oauth-helpers";

const urls = mcpUrls(authConfig.BETTER_AUTH_URL);
const base = authConfig.BETTER_AUTH_URL;

async function fixture(dependencies: AuthDependencies = {}) {
  const repo = await createEmptyRepository();
  await repo.store.ready;
  const bundle = createProjectAuth(repo, authConfig, dependencies);
  await mockOAuth(bundle);
  // The first account becomes the administrator through the normal web login.
  await oauthLogin(bundle, "google", "admin@example.com");
  return { repo, bundle };
}
async function withGlobalAuth<T>(
  repo: Awaited<ReturnType<typeof createRepository>>,
  run: () => Promise<T>,
) {
  const old = { ...process.env };
  Object.assign(globalThis, { taskodeRepository: repo });
  Object.assign(process.env, authConfig);
  try {
    return await run();
  } finally {
    for (const key of Object.keys(process.env))
      if (!(key in old)) delete process.env[key];
    Object.assign(process.env, old);
    Reflect.deleteProperty(globalThis, "taskodeRepository");
    Reflect.deleteProperty(globalThis, "taskodeAuth");
  }
}

test("OAuth MCP: registro dinámico, login social, consentimiento y token con PKCE ligados al recurso MCP", async () => {
  const { repo, bundle } = await fixture();
  try {
    const result = await oauthAuthorize(bundle, { email: "admin@example.com" });
    assert.ok(result.access_token, JSON.stringify(result));
    const claims = decodeJwt(result.access_token!);
    const admin = (await repo.store.db.select().from(schema.user))[0];
    assert.equal(claims.sub, admin.id);
    assert.equal(claims.iss, urls.issuer);
    assert.deepEqual([claims.aud].flat().includes(urls.resource), true);
    assert.match(String(claims.scope), /taskode:read/);
    assert.ok(result.refresh_token, "offline_access entrega refresh token");
    const refreshed = await refreshTokens(bundle, result.client, result.refresh_token!);
    assert.equal(refreshed.status, 200, await refreshed.clone().text());
    const consents = await repo.store.db
      .select()
      .from(schema.oauthConsent)
      .where(eq(schema.oauthConsent.userId, admin.id));
    assert.equal(consents.length, 1);
  } finally {
    await repo.close();
  }
});

test("OAuth MCP: metadatos RFC 9728/8414 en la raíz del dominio con CORS público", async () => {
  const repo = await createRepository();
  try {
    await withGlobalAuth(repo, async () => {
      const prmPaths = [
        "/.well-known/oauth-protected-resource/api/mcp",
        "/.well-known/oauth-protected-resource",
      ];
      for (const path of prmPaths) {
        const response = await wellKnownHandler("protected-resource")(new Request(`${base}${path}`));
        assert.equal(response.status, 200, path);
        assert.equal(response.headers.get("access-control-allow-origin"), "*");
        const prm = await response.json();
        assert.equal(prm.resource, urls.resource);
        assert.deepEqual(prm.authorization_servers, [urls.issuer]);
        assert.ok(prm.scopes_supported.includes("taskode:read"));
      }
      for (const path of [
        "/.well-known/oauth-authorization-server/api/auth",
        "/.well-known/oauth-authorization-server",
      ]) {
        const response = await wellKnownHandler("authorization-server")(new Request(`${base}${path}`));
        assert.equal(response.status, 200, path);
        const as = await response.json();
        assert.equal(as.issuer, urls.issuer);
        assert.ok(as.registration_endpoint, "registro dinámico anunciado");
        assert.ok(as.code_challenge_methods_supported.includes("S256"));
        assert.ok(as.token_endpoint_auth_methods_supported.includes("none"));
        assert.equal(as.client_id_metadata_document_supported, true);
        assert.ok(!as.grant_types_supported.includes("client_credentials"));
      }
      for (const path of [
        "/.well-known/openid-configuration",
        "/.well-known/openid-configuration/api/auth",
      ]) {
        const response = await wellKnownHandler("openid-configuration")(new Request(`${base}${path}`));
        assert.equal(response.status, 200, path);
        assert.equal((await response.json()).issuer, urls.issuer);
      }
      const unknown = await wellKnownHandler("openid-configuration")(
        new Request(`${base}/.well-known/openid-configuration/otro`),
      );
      assert.equal(unknown.status, 404);
    });
  } finally {
    await repo.close();
  }
});

test("OAuth MCP: conectar una app nunca crea cuentas, ni siquiera con invitación válida", async () => {
  const { repo, bundle } = await fixture();
  try {
    const outsider = await oauthAuthorize(bundle, { email: "outsider@example.com" });
    assert.ok(!outsider.access_token);
    assert.match(outsider.callback.headers.get("location") ?? "", /error/);
    const admin = (await repo.store.db.select().from(schema.user))[0];
    const invites = new InvitationService(repo, authConfig.BETTER_AUTH_SECRET, base);
    const created = await invites.create({ email: "invited@example.com", projectIds: [] }, { id: admin.id });
    assert.equal(created.kind, "invitation");
    const invited = await oauthAuthorize(bundle, { email: "invited@example.com" });
    assert.ok(!invited.access_token);
    assert.equal((await repo.store.db.select().from(schema.user)).length, 1);
    const invitation = (await repo.store.db.select().from(schema.invitations))[0];
    assert.equal(invitation.acceptedAt, null, "la invitación sigue disponible");
    assert.equal((await repo.store.db.select().from(schema.oauthConsent)).length, 0);
  } finally {
    await repo.close();
  }
});

test("OAuth MCP: /token del plugin jwt deshabilitado y gestión de clientes por sesión solo para el admin", async () => {
  const repo = await createRepository();
  try {
    await withGlobalAuth(repo, async () => {
      const { getAuth } = await import("../src/server/auth");
      const bundle = getAuth();
      const token = await bundle.handle(await authenticatedRequest(`${base}/api/auth/token`));
      assert.equal(token.status, 404);
      await addUser(repo, "oauth-member");
      const create = (userId: string) =>
        authenticatedRequest(
          `${base}/api/auth/oauth2/create-client`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", Origin: base },
            body: JSON.stringify({
              redirect_uris: ["https://app.example.com/callback"],
              client_name: "Manual",
            }),
          },
          userId,
        );
      const denied = await bundle.handle(await create("oauth-member"));
      assert.equal(denied.status, 401);
      const allowed = await bundle.handle(await create("test-admin"));
      assert.ok(allowed.ok, await allowed.clone().text());
    });
  } finally {
    await repo.close();
  }
});

test("OAuth MCP: Client ID Metadata Document (CIMD) sin registro previo", async () => {
  const clientId = "https://cliente.example.com/oauth/metadata.json";
  const fetched: string[] = [];
  const { repo, bundle } = await fixture({
    fetchClientMetadataResource: async (input) => {
      fetched.push(String(input));
      return Response.json(
        {
          client_id: clientId,
          client_name: "Cliente CIMD",
          redirect_uris: [REDIRECT_URI],
          token_endpoint_auth_method: "none",
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
        },
        { headers: { "Cache-Control": "max-age=300" } },
      );
    },
  });
  try {
    const result = await oauthAuthorize(bundle, { email: "admin@example.com", clientId });
    assert.ok(result.access_token, JSON.stringify(result));
    assert.deepEqual(fetched, [clientId]);
    const client = (
      await repo.store.db.select().from(schema.oauthClient).where(eq(schema.oauthClient.clientId, clientId))
    )[0];
    assert.equal(client.name, "Cliente CIMD");
  } finally {
    await repo.close();
  }
});
