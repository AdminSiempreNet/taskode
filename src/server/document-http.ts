import { documentSaveSchema, MAX_DOCUMENT_BYTES } from "../lib/documents";
import { entityKindSchema } from "../lib/validation";
import { assertOrigin, httpError, requireActor } from "./access";
import { repository } from "./index";
import { DocumentsService } from "./documents";
import { DomainError } from "./repository";
import { deliverNotificationEvents } from "./notification-http";

const headers = {
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow",
};
async function body(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new DomainError("Faltan los datos.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_DOCUMENT_BYTES) {
      await reader.cancel();
      throw new DomainError("El documento supera el tamaño permitido.", 413);
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
async function route(
  request: Request,
  action: (service: DocumentsService) => Promise<unknown>,
) {
  try {
    if (!["GET", "HEAD"].includes(request.method)) assertOrigin(request);
    const result = await action(new DocumentsService(repository()));
    if (!["GET", "HEAD"].includes(request.method)) deliverNotificationEvents();
    return Response.json(result, {
      headers,
    });
  } catch (error) {
    const response =
      error instanceof SyntaxError
        ? Response.json({ error: "JSON inválido." }, { status: 400 })
        : httpError(error);
    for (const [key, value] of Object.entries(headers))
      response.headers.set(key, value);
    return response;
  }
}
type EntityContext = {
  params: Promise<{ kind: string; id: string; diagramId?: string }>;
};
function kind(value: string) {
  const parsed = entityKindSchema.safeParse(value);
  if (!parsed.success) throw new DomainError("El elemento no existe.", 404);
  return parsed.data;
}
export async function entityDocuments(
  request: Request,
  context: EntityContext,
) {
  return route(request, async (service) => {
    const actor = await requireActor(request),
      params = await context.params,
      target = kind(params.kind);
    return request.method === "POST"
      ? service.create(actor, target, params.id, await body(request))
      : service.list(actor, target, params.id);
  });
}
export async function documentDetail(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return route(request, async (service) => {
    const actor = await requireActor(request),
      { id } = await context.params;
    if (request.method === "DELETE") {
      await service.remove(actor, id);
      return { ok: true };
    }
    if (request.method === "PUT") {
      const parsed = documentSaveSchema.safeParse(await body(request));
      if (!parsed.success)
        throw new DomainError("Datos del documento inválidos.");
      const { revision, ...value } = parsed.data;
      return service.save(actor, id, revision, value);
    }
    return service.get(actor, id);
  });
}
export async function documentDiagrams(
  request: Request,
  context: EntityContext,
) {
  return route(request, async (service) => {
    const actor = await requireActor(request),
      params = await context.params,
      target = kind(params.kind);
    return params.diagramId
      ? service.diagram(actor, target, params.id, params.diagramId)
      : service.diagramOptions(actor, target, params.id);
  });
}
