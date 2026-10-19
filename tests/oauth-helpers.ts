import { createHash, randomBytes } from "node:crypto";
import type { createProjectAuth } from "../src/server/auth";
import { mcpUrls } from "../src/server/mcp/config";
import { authConfig } from "./helpers";

type Bundle = ReturnType<typeof createProjectAuth>;
export const REDIRECT_URI = "http://127.0.0.1:33418/callback";
const base = authConfig.BETTER_AUTH_URL;
const cookiesOf = (response: Response) =>
  response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]);
function mergeCookies(jar: Map<string, string>, response: Response) {
  for (const cookie of cookiesOf(response)) {
    const [name, ...value] = cookie.split("=");
    jar.set(name, value.join("="));
  }
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}
export async function registerClient(bundle: Bundle, name = "Cliente MCP de prueba") {
  const response = await bundle.handle(
    new Request(`${base}/api/auth/oauth2/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: name,
        redirect_uris: [REDIRECT_URI],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      }),
    }),
  );
  const body = await response.json();
  if (!response.ok) throw new Error(`register ${response.status}: ${JSON.stringify(body)}`);
  return body as { client_id: string };
}
export function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return {
    verifier,
    challenge: createHash("sha256").update(verifier).digest("base64url"),
  };
}
export async function authorizeRequest(
  bundle: Bundle,
  clientId: string,
  { scopes, challenge, cookie, state = "estado-de-prueba" }: {
    scopes: string[];
    challenge: string;
    cookie?: string;
    state?: string;
  },
) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    scope: scopes.join(" "),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: mcpUrls(base).resource,
  });
  return bundle.handle(
    new Request(`${base}/api/auth/oauth2/authorize?${params}`, {
      headers: { Accept: "text/html", ...(cookie ? { Cookie: cookie } : {}) },
    }),
  );
}
// Full authorization code + PKCE flow through the real Better Auth handler with a mocked
// social provider (see mockOAuth). Returns the token response and intermediate URLs.
export async function oauthAuthorize(
  bundle: Bundle,
  {
    email,
    scopes = ["taskode:read", "taskode:write", "offline_access"],
    consentScopes,
    clientId,
    provider = "google",
  }: {
    email: string;
    scopes?: string[];
    consentScopes?: string[];
    clientId?: string;
    provider?: string;
  },
) {
  const client = clientId ?? (await registerClient(bundle)).client_id;
  const { verifier, challenge } = pkce();
  const jar = new Map<string, string>();
  const authorize = await authorizeRequest(bundle, client, { scopes, challenge });
  const loginUrl = new URL(authorize.headers.get("location") ?? "", base);
  if (loginUrl.pathname !== "/login")
    throw new Error(`authorize → ${authorize.status} ${loginUrl}`);
  const start = await bundle.handle(
    new Request(`${base}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: base },
      body: JSON.stringify({
        provider,
        callbackURL: "/dashboard",
        errorCallbackURL: "/login?error=oauth",
        oauth_query: loginUrl.search.slice(1),
      }),
    }),
  );
  const started = await start.json();
  if (!started.url) throw new Error(`sign-in → ${JSON.stringify(started)}`);
  let cookie = mergeCookies(jar, start);
  const state = new URL(started.url).searchParams.get("state")!;
  const callback = await bundle.handle(
    new Request(
      `${base}/api/auth/callback/${provider}?${new URLSearchParams({ code: email, state })}`,
      { headers: { Cookie: cookie, Accept: "text/html" } },
    ),
  );
  cookie = mergeCookies(jar, callback);
  const consentUrl = new URL(callback.headers.get("location") ?? "", base);
  if (consentUrl.pathname !== "/oauth/consent")
    return {
      client,
      callback,
      consentUrl,
      cookie,
      verifier,
      access_token: undefined,
      refresh_token: undefined,
    };
  const consent = await bundle.handle(
    new Request(`${base}/api/auth/oauth2/consent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: base, Cookie: cookie },
      body: JSON.stringify({
        accept: true,
        ...(consentScopes ? { scope: consentScopes.join(" ") } : {}),
        oauth_query: consentUrl.search.slice(1),
      }),
    }),
  );
  const consented = await consent.json();
  if (!consented.url) throw new Error(`consent ${consent.status}: ${JSON.stringify(consented)}`);
  const redirect = new URL(consented.url);
  const code = redirect.searchParams.get("code");
  if (!code) throw new Error(`consent redirect sin code: ${redirect}`);
  const tokens = await exchangeCode(bundle, { client, code, verifier });
  return { client, callback, consentUrl, cookie, verifier, redirect, ...tokens };
}
export async function exchangeCode(
  bundle: Bundle,
  { client, code, verifier }: { client: string; code: string; verifier: string },
) {
  const response = await bundle.handle(
    new Request(`${base}/api/auth/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
        client_id: client,
        code_verifier: verifier,
        resource: mcpUrls(base).resource,
      }),
    }),
  );
  const body = await response.json();
  if (!response.ok) throw new Error(`token ${response.status}: ${JSON.stringify(body)}`);
  return body as {
    access_token: string;
    refresh_token?: string;
    scope: string;
    expires_in: number;
    token_type: string;
  };
}
export async function refreshTokens(bundle: Bundle, client: string, refreshToken: string) {
  return bundle.handle(
    new Request(`${base}/api/auth/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: client,
        resource: mcpUrls(base).resource,
      }),
    }),
  );
}
