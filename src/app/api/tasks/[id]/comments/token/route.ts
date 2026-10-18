import { repository } from "@/server";
import { assertOrigin, httpError, requireActor } from "@/server/access";
import { commentsToken } from "@/server/realtime";
import { ablyConfig } from "@/server/realtime-config";
export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertOrigin(request);
    const actor = await requireActor(request);
    const id = (await context.params).id;
    await repository().requireTask(actor, id);
    if (!ablyConfig())
      return Response.json(
        { error: "La conexión en tiempo real no está configurada." },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    return new Response(await commentsToken(id, actor.id), {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return httpError(error);
  }
}
