import { repository } from "@/server";
import { assertOrigin, httpError, requireActor } from "@/server/access";
import { deliverNotificationEvents } from "@/server/notification-http";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const actor = await requireActor(request);
    return Response.json(await repository().users.projects(actor, (await context.params).id), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return httpError(error); }
}
export async function PATCH(request: Request, context: Context) {
  try {
    assertOrigin(request);
    const actor = await requireActor(request);
    // Authenticate before reading the body, including for malformed requests.
    await repository().requireAdmin(actor);
    const result = await repository().users.update(actor, (await context.params).id, await request.json());
    deliverNotificationEvents();
    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof SyntaxError) return Response.json({ error: "Datos inválidos." }, { status: 400 });
    return httpError(error);
  }
}
