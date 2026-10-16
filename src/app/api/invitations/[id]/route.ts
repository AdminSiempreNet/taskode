import { invitationService } from "@/server/auth";
import { assertOrigin, httpError, requireActor } from "@/server/access";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function DELETE(request: Request, context: Context) {
  try {
    assertOrigin(request);
    await invitationService().revoke(
      (await context.params).id,
      await requireActor(request),
    );
    return new Response(null, { status: 204 });
  } catch (error) {
    return httpError(error);
  }
}
export async function POST(request: Request, context: Context) {
  try {
    assertOrigin(request);
    return Response.json(
      await invitationService().resend(
        (await context.params).id,
        await requireActor(request),
      ),
    );
  } catch (error) {
    return httpError(error);
  }
}
