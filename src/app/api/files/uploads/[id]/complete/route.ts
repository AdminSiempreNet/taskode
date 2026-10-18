import { repository } from "@/server";
import { FileManager } from "@/server/files";
import { assertOrigin, requireActor, httpError } from "@/server/access";
import { DomainError } from "@/server/repository";
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
      body.taskId !== undefined &&
      (typeof body.taskId !== "string" || body.taskId.length > 200)
    )
      throw new DomainError("Tarea inválida.");
    return Response.json(
      await new FileManager(repository()).complete(
        actor,
        (await context.params).id,
        body.taskId,
      ),
    );
  } catch (error) {
    return httpError(error);
  }
}
