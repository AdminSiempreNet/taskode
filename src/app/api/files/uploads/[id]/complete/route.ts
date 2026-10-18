import { repository } from "@/server";
import { FileManager } from "@/server/files";
import { assertOrigin, requireActor, httpError } from "@/server/access";
import { DomainError } from "@/server/repository";
import { entityRefSchema } from "@/lib/validation";
export const runtime = "nodejs";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertOrigin(request);
    const actor = await requireActor(request);
    const body = await request.json();
    if (
      (body.scope !== undefined &&
        !entityRefSchema.safeParse(body.scope).success) ||
      (body.scope && body.taskId)
    )
      throw new DomainError("Destino de archivo inválido.");
    if (
      body.taskId !== undefined &&
      (typeof body.taskId !== "string" || body.taskId.length > 200)
    )
      throw new DomainError("Tarea inválida.");
    return Response.json(
      await new FileManager(repository()).complete(
        actor,
        (await context.params).id,
        body.scope ? entityRefSchema.parse(body.scope) : body.taskId,
      ),
    );
  } catch (error) {
    return httpError(error);
  }
}
