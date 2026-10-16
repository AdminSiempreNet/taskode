import { authConfigured, getAuth } from "@/server/auth";
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
  return getAuth().handle(request);
}
export { handler as GET, handler as POST };
