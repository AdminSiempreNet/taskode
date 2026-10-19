import { paginationSchema } from "../lib/pagination";
import { ticketPageSchema } from "../lib/catalogs";
import { httpError, requireActor } from "./access";
import { repository } from "./index";
import { CatalogsService } from "./catalogs";
import { DomainError } from "./repository";

export function catalogPage(kind: "clients" | "tickets") {
  return async (request: Request) => {
    try {
      const actor = await requireActor(request);
      const params = new URL(request.url).searchParams;
      const parsed = (kind === "tickets" ? ticketPageSchema : paginationSchema).safeParse(Object.fromEntries(params));
      const selectedId = params.get("selectedId") ?? undefined;
      if (!parsed.success || (selectedId !== undefined && (!selectedId || selectedId.length > 200)))
        throw new DomainError("Parámetros de paginación inválidos.");
      const service = new CatalogsService(repository());
      return Response.json(kind === "clients" ? await service.clients(actor, parsed.data, selectedId) : await service.tickets(actor, parsed.data), {
        headers: { "Cache-Control": "private, no-store" },
      });
    } catch (error) { return httpError(error); }
  };
}
