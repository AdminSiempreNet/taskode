import { repository } from "@/server";
import { requireActor, httpError, assertOrigin } from "@/server/access";
import { commandSchema } from "@/lib/validation";
import { DomainError } from "@/server/repository";
import { commentsRealtime } from "@/server/realtime-config";
import { deliverCommentEvents } from "@/server/comment-http";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireActor(request);
    const id = (await context.params).id;
    const snapshot = await repository().taskComments(actor, id);
    deliverCommentEvents();
    return Response.json(
      { ...snapshot, realtime: commentsRealtime(id, actor.id) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return httpError(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertOrigin(request);
    const actor = await requireActor(request);
    // Bound the stream itself; Content-Length may be missing or forged.
    const reader = request.body?.getReader();
    if (!reader) throw new DomainError("Falta el comentario.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > 64 * 1024) {
        await reader.cancel();
        throw new DomainError("El comentario es demasiado grande.", 413);
      }
      chunks.push(chunk.value);
    }
    const parsed = commandSchema.safeParse(
      JSON.parse(Buffer.concat(chunks).toString("utf8")),
    );
    if (!parsed.success || !parsed.data.type.startsWith("comment."))
      throw new DomainError("Comentario inválido.");
    const id = (await context.params).id;
    const result = await repository().executeComment(actor, id, parsed.data);
    deliverCommentEvents();
    return Response.json(
      { ...result, realtime: commentsRealtime(id, actor.id) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof SyntaxError)
      return Response.json({ error: "Comentario inválido." }, { status: 400 });
    return httpError(error);
  }
}
