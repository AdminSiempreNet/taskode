import { invitationService } from "@/server/auth";
import { assertOrigin, httpError, requireActor } from "@/server/access";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    return Response.json(
      {
        invitations: await invitationService().list(
          await requireActor(request),
        ),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return httpError(error);
  }
}
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const actor = await requireActor(request);
    return Response.json(
      await invitationService().create(await request.json(), actor),
      { status: 201 },
    );
  } catch (error) {
    return httpError(error);
  }
}
