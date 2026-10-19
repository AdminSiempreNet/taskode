import { requireActor, httpError } from "@/server/access";
import { repository } from "@/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    return Response.json(
      await repository().getGeography(await requireActor(request)),
      {
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    return httpError(error);
  }
}
