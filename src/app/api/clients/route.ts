import { catalogPage } from "@/server/catalog-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = catalogPage("clients");
