import { CatalogsService } from "@/server/catalogs";
import { repository } from "@/server";
import { requireActor, httpError } from "@/server/access";
import { DomainError } from "@/server/repository";
import { entityKindSchema } from "@/lib/validation";
import { paginationSchema } from "@/lib/pagination";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string; kind: string }> }) {
  try {
    const actor = await requireActor(request), { id, kind } = await context.params;
    const parsedKind = entityKindSchema.safeParse(kind);
    const parsedPage = paginationSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsedKind.success || !parsedPage.success || !id || id.length > 200)
      throw new DomainError("Parámetros de vínculos inválidos.");
    return Response.json(await new CatalogsService(repository()).ticketLinks(actor, id, parsedKind.data, parsedPage.data), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) { return httpError(error); }
}
