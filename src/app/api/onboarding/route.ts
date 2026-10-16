import { repository } from "@/server";
import { assertOrigin, requireActor, httpError } from "@/server/access";
import { createFirstProject, finishOnboarding } from "@/server/onboarding";
import { DomainError } from "@/server/repository";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const actor = await requireActor(request),
      body = await request.json();
    if (body.action === "create-project")
      return Response.json(
        await createFirstProject(
          repository(),
          actor,
          body.project,
          body.demo === true,
        ),
      );
    if (body.action === "finish") {
      await finishOnboarding(repository(), actor);
      return Response.json({ ok: true });
    }
    throw new DomainError("Acción no válida.");
  } catch (error) {
    return httpError(error);
  }
}
