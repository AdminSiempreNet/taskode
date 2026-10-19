import { wellKnownHandler, wellKnownPreflight } from "@/server/mcp/well-known";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handler = wellKnownHandler("protected-resource");
export { handler as GET, handler as HEAD, wellKnownPreflight as OPTIONS };
