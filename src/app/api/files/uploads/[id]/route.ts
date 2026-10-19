import { repository } from "@/server";
import { FileManager } from "@/server/files";
import { assertOrigin, requireActor, httpError } from "@/server/access";
export const runtime = "nodejs";
export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertOrigin(request);
    const actor = await requireActor(request);
    await new FileManager(repository()).put(
      actor,
      (await context.params).id,
      request,
    );
    return Response.json({ ok: true });
  } catch (error) {
    return httpError(error);
  }
}
