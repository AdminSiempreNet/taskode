import { repository } from "@/server";

export const dynamic = "force-dynamic";

export async function GET() {
  // El healthcheck del despliegue espera también las migraciones y su backfill.
  await repository().store.ready;
  return Response.json(
    { status: "ok" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
