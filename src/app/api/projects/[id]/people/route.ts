import { repository } from "@/server";
import { requireActor, httpError } from "@/server/access";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireActor(request);
    return Response.json(
      {
        people: await repository().projectPeople(
          actor,
          (await context.params).id,
        ),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return httpError(error);
  }
}
