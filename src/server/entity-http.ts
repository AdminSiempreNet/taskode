import { repository } from "./index";
import { assertOrigin, httpError, requireActor } from "./access";
import { commandSchema, entityKindSchema } from "../lib/validation";
import { DomainError } from "./repository";
import { commentsRealtime, ablyConfig } from "./realtime-config";
import { commentsToken } from "./realtime";
import { deliverCommentEvents } from "./comment-http";
import { deliverNotificationEvents } from "./notification-http";

export type EntityContext = { params: Promise<{ kind: string; id: string }> };
const noStore = { "Cache-Control": "no-store" };
async function target(context: EntityContext) {
  const { kind, id } = await context.params;
  const parsed = entityKindSchema.safeParse(kind);
  if (!parsed.success || !id || id.length > 200)
    throw new DomainError("El elemento no existe.", 404);
  return { kind: parsed.data, id };
}
export async function getEntity(request: Request, context: EntityContext) {
  try {
    const actor = await requireActor(request);
    const { kind, id } = await target(context);
    return Response.json(await repository().entityDetail(actor, kind, id), {
      headers: noStore,
    });
  } catch (error) {
    return httpError(error);
  }
}
export async function getComments(request: Request, context: EntityContext) {
  try {
    const actor = await requireActor(request);
    const { kind, id } = await target(context);
    const snapshot = await repository().entityComments(actor, kind, id);
    deliverCommentEvents();
    return Response.json(
      { ...snapshot, realtime: commentsRealtime(id, actor.id, kind) },
      { headers: noStore },
    );
  } catch (error) {
    return httpError(error);
  }
}
export async function postComment(request: Request, context: EntityContext) {
  try {
    assertOrigin(request);
    const actor = await requireActor(request);
    const { kind, id } = await target(context);
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
    const result = await repository().executeEntityComment(
      actor,
      kind,
      id,
      parsed.data,
    );
    deliverCommentEvents();
    deliverNotificationEvents();
    return Response.json(
      { ...result, realtime: commentsRealtime(id, actor.id, kind) },
      { headers: noStore },
    );
  } catch (error) {
    if (error instanceof SyntaxError)
      return Response.json(
        { error: "Comentario inválido." },
        { status: 400, headers: noStore },
      );
    return httpError(error);
  }
}
export async function postCommentsToken(
  request: Request,
  context: EntityContext,
) {
  try {
    assertOrigin(request);
    const actor = await requireActor(request);
    const { kind, id } = await target(context);
    await repository().requireEntity(actor, kind, id);
    if (!ablyConfig())
      return Response.json(
        { error: "La conexión en tiempo real no está configurada." },
        { status: 503, headers: noStore },
      );
    return new Response(await commentsToken(id, actor.id, kind), {
      headers: { ...noStore, "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (error) {
    return httpError(error);
  }
}
