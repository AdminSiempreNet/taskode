import { createMcpProtectedRequestHandler } from "@better-auth/mcp";
import { createMcpHandler, type McpHttpHandler, type McpRequestContext } from "@modelcontextprotocol/server";
import { createDpopReplayStore } from "better-auth/oauth2";
import { and, eq } from "drizzle-orm";
import type { JWTPayload } from "jose";
import { authConfigured, getAuth } from "../auth";
import { httpEffects, type Effects } from "../commands";
import { repository } from "../index";
import { isDomainError } from "../repository";
import * as schema from "../schema";
import {
  MCP_CHALLENGE_SCOPES,
  MCP_SCOPES,
  mcpAllowedOrigins,
  mcpEnabled,
  mcpUrls,
} from "./config";
import type { McpContext } from "./context";
import { originPreflight, withOriginCors } from "./cors";
import { createTaskodeServer } from "./server";

const METHODS = "GET, POST, DELETE, OPTIONS";
const rpcError = (status: number, message: string, headers: Record<string, string> = {}) =>
  Response.json(
    { jsonrpc: "2.0", error: { code: -32000, message }, id: null },
    { status, headers: { "Cache-Control": "no-store", ...headers } },
  );
function revoked(message: string) {
  const urls = mcpUrls();
  return rpcError(401, message, {
    "WWW-Authenticate": `Bearer error="invalid_token", error_description="${message}", resource_metadata="${urls.protectedResourceMetadata}"`,
  });
}
function contextOf(request: McpRequestContext): McpContext {
  const context = request.authInfo?.extra?.taskode as McpContext | undefined;
  if (!context) throw new Error("MCP request without a verified Taskode context");
  return context;
}
export interface McpEndpointOptions {
  effects?: Effects;
}
// POST /api/mcp: Streamable HTTP, stateless. Bearer tokens only (never cookies), issued by our
// authorization server for this exact resource. Tools act as the token's subject.
export function createMcpEndpoint({ effects = httpEffects }: McpEndpointOptions = {}) {
  let mcp: McpHttpHandler | undefined;
  const protectedHandlers = new Map<string, Promise<(request: Request) => Promise<Response>>>();
  const serverHandler = () =>
    (mcp ??= createMcpHandler((request) => createTaskodeServer(contextOf(request)), {
      onerror: (error) => console.error("[mcp]", error.message),
    }));
  async function serve(request: Request, claims: JWTPayload) {
    const urls = mcpUrls();
    const repo = repository();
    const userId = typeof claims.sub === "string" ? claims.sub : "";
    const clientId = String(claims.azp ?? claims.client_id ?? "");
    let user;
    try {
      user = await repo.currentUser({ id: userId });
    } catch (error) {
      if (isDomainError(error)) return revoked("account not found");
      throw error;
    }
    // Revoking a connection deletes its consent: checked on every request, effective at once.
    const grant = await repo.store.db
      .select({ disabled: schema.oauthClient.disabled })
      .from(schema.oauthConsent)
      .innerJoin(schema.oauthClient, eq(schema.oauthClient.clientId, schema.oauthConsent.clientId))
      .where(and(eq(schema.oauthConsent.userId, userId), eq(schema.oauthConsent.clientId, clientId)))
      .limit(1);
    if (!grant.length || grant[0].disabled) return revoked("authorization revoked");
    const scopes = new Set(String(claims.scope ?? "").split(" ").filter(Boolean));
    const context: McpContext = {
      repo,
      actor: { id: userId },
      user,
      scopes,
      clientId,
      effects,
      origin: urls.origin,
    };
    const token = (request.headers.get("authorization") ?? "").replace(/^\S+\s+/, "");
    return serverHandler().fetch(request, {
      authInfo: {
        token,
        clientId,
        scopes: [...scopes],
        expiresAt: typeof claims.exp === "number" ? claims.exp : undefined,
        resource: new URL(urls.resource),
        resourceMetadataUrl: urls.protectedResourceMetadata,
        extra: { taskode: context },
      },
    });
  }
  function protectedHandler() {
    const urls = mcpUrls();
    const jwksUrl = process.env.MCP_JWKS_URL || urls.jwks;
    const key = `${urls.issuer}|${urls.resource}|${jwksUrl}`;
    let handler = protectedHandlers.get(key);
    if (!handler) {
      handler = (async () => {
        const { internalAdapter } = await getAuth().instance.$context;
        return createMcpProtectedRequestHandler(
          {
            issuer: urls.issuer,
            audience: urls.resource,
            jwksUrl,
            jwtVerifyOptions: { clockTolerance: 5 },
            requiredScopes: [MCP_SCOPES.read],
            challengeScopes: MCP_CHALLENGE_SCOPES,
            dpop: { replayStore: createDpopReplayStore(internalAdapter) },
          },
          serve,
        );
      })();
      protectedHandlers.set(key, handler);
    }
    return handler;
  }
  function precheck(request: Request) {
    if (!mcpEnabled()) return rpcError(404, "MCP no está habilitado.");
    if (!authConfigured()) return rpcError(503, "La autenticación de Taskode no está configurada.");
    // MCP spec: validate Origin to prevent DNS rebinding. Native clients send none.
    const origin = request.headers.get("origin");
    if (origin && !mcpAllowedOrigins().has(origin)) return rpcError(403, "Origen no permitido.");
    return null;
  }
  async function handle(request: Request) {
    const rejected = precheck(request);
    if (rejected) return rejected;
    await repository().store.ready;
    try {
      const response = await (await protectedHandler())(request);
      return withOriginCors(response, request.headers.get("origin"), METHODS);
    } catch (error) {
      console.error("[mcp] request failed", error instanceof Error ? error.message : error);
      return rpcError(503, "No se pudo verificar la autorización. Vuelve a intentarlo.");
    }
  }
  function options(request: Request) {
    const origin = request.headers.get("origin");
    if (origin && !mcpAllowedOrigins().has(origin)) return rpcError(403, "Origen no permitido.");
    return originPreflight(origin, METHODS);
  }
  return { handle, options };
}
const endpoint = createMcpEndpoint();
export const mcpHandle = endpoint.handle;
export const mcpOptions = endpoint.options;
