import { invitationService } from "@/server/auth";
import { assertOrigin, httpError, requireActor } from "@/server/access";
import { deliverNotificationEvents } from "@/server/notification-http";
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
    const result = await invitationService().create(await request.json(), actor);
    deliverNotificationEvents();
    return Response.json(
      result,
      { status: result.kind === "invitation" ? 201 : 200, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return httpError(error);
  }
}
