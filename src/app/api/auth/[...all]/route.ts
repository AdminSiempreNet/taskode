import { authConfigured, getAuth } from "@/server/auth";
import { publicPreflight, withPublicCors } from "@/server/mcp/cors";
import { deliverNotificationEvents } from "@/server/notification-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Endpoints MCP clients call directly, without cookies (token, registration, discovery).
const PUBLIC_OAUTH_PATH =
  /^\/api\/auth\/(?:oauth2\/(?:token|register|revoke|introspect|userinfo)|jwks|\.well-known\/[\w-]+)\/?$/;
const isPublicOAuth = (request: Request) =>
  PUBLIC_OAUTH_PATH.test(new URL(request.url).pathname);
async function handler(request: Request) {
  if (!authConfigured())
    return Response.json(
      {
        error:
          "Configura BETTER_AUTH_SECRET y las credenciales de Google o GitHub.",
      },
      { status: 503 },
    );
  const response = await getAuth().handle(request);
  if (isPublicOAuth(request)) return withPublicCors(response);
  deliverNotificationEvents();
  return response;
}
function preflight(request: Request) {
  return isPublicOAuth(request)
    ? publicPreflight()
    : new Response(null, { status: 404 });
}
export { handler as GET, handler as POST, preflight as OPTIONS };
