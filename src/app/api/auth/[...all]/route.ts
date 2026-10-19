import { authConfigured, getAuth } from "@/server/auth";
import { deliverNotificationEvents } from "@/server/notification-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
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
  deliverNotificationEvents();
  return response;
}
export { handler as GET, handler as POST };
