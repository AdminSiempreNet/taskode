// CORS for OAuth discovery/token endpoints and the MCP endpoint. Never allows credentials:
// these endpoints authenticate with bearer tokens or PKCE, not cookies.
const ALLOWED_HEADERS =
  "authorization, content-type, dpop, mcp-protocol-version, mcp-session-id, last-event-id";
const EXPOSED_HEADERS = "WWW-Authenticate, MCP-Protocol-Version, Mcp-Session-Id, DPoP-Nonce";

function withHeaders(response: Response, headers: Record<string, string>) {
  const next = new Headers(response.headers);
  for (const [key, value] of Object.entries(headers)) next.set(key, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: next,
  });
}
function corsHeaders(origin: string, methods: string) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": methods,
    "Access-Control-Allow-Headers": ALLOWED_HEADERS,
    "Access-Control-Expose-Headers": EXPOSED_HEADERS,
    "Access-Control-Max-Age": "86400",
    ...(origin === "*" ? {} : { Vary: "Origin" }),
  };
}
export function withPublicCors(response: Response, methods = "GET, HEAD, POST, OPTIONS") {
  return withHeaders(response, corsHeaders("*", methods));
}
export function publicPreflight(methods = "GET, HEAD, POST, OPTIONS") {
  return new Response(null, { status: 204, headers: corsHeaders("*", methods) });
}
export function withOriginCors(response: Response, origin: string | null, methods: string) {
  return origin ? withHeaders(response, corsHeaders(origin, methods)) : response;
}
export function originPreflight(origin: string | null, methods: string) {
  return new Response(null, {
    status: 204,
    headers: origin ? corsHeaders(origin, methods) : { Allow: methods },
  });
}
