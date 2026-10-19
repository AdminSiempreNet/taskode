import { repository } from "@/server";
import { FileManager } from "@/server/files";
import { assertOrigin, requireActor, httpError } from "@/server/access";
export const runtime = "nodejs";
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertOrigin(request);
    await new FileManager(repository()).remove(
      await requireActor(request),
      (await context.params).id,
    );
    return Response.json({ ok: true });
  } catch (error) {
    return httpError(error);
  }
}
