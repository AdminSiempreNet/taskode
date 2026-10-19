import { MAX_DIAGRAM_BYTES, diagramSaveSchema } from "../lib/diagrams";
import { entityKindSchema } from "../lib/validation";
import { assertOrigin, httpError, requireActor } from "./access";
import { repository } from "./index";
import { DiagramsService } from "./diagrams";
import { DomainError } from "./repository";

const headers = {
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
};
async function body(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new DomainError("Faltan los datos.");
  let size = 0;
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_DIAGRAM_BYTES + 128) {
      await reader.cancel();
      throw new DomainError("El diagrama supera el límite de 3 MB.", 413);
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
async function route(
  request: Request,
  action: (service: DiagramsService) => Promise<unknown>,
) {
  try {
    if (!["GET", "HEAD"].includes(request.method)) assertOrigin(request);
    return Response.json(await action(new DiagramsService(repository())), {
      headers,
    });
  } catch (error) {
    if (error instanceof SyntaxError)
      return Response.json(
        { error: "JSON inválido." },
        { status: 400, headers },
      );
    const response = httpError(error);
    for (const [name, value] of Object.entries(headers))
      response.headers.set(name, value);
    return response;
  }
}
export async function entityDiagrams(
  request: Request,
  context: { params: Promise<{ kind: string; id: string }> },
) {
  return route(request, async (service) => {
    const actor = await requireActor(request),
      { kind, id } = await context.params;
    const parsed = entityKindSchema.safeParse(kind);
    if (!parsed.success) throw new DomainError("El elemento no existe.", 404);
    return request.method === "POST"
      ? service.create(actor, parsed.data, id, await body(request))
      : service.list(actor, parsed.data, id);
  });
}
export async function diagramDetail(
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
      const parsed = diagramSaveSchema.safeParse(await body(request));
      if (!parsed.success)
        throw new DomainError("Datos del diagrama inválidos.");
      const { revision, ...document } = parsed.data;
      return service.save(actor, id, revision, document);
    }
    return service.get(actor, id);
  });
}
export async function diagramShare(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return route(request, async (service) =>
    service.share(
      await requireActor(request),
      (await context.params).id,
      request.method === "POST",
    ),
  );
}
export async function publicDiagram(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  return route(request, async (service) =>
    service.publicDocument((await context.params).token),
  );
}
