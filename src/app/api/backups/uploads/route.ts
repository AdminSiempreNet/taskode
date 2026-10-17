import { adminRoute } from "@/server/access";
import { backups } from "@/server";
import { assertBackupOrigin, backupError } from "@/server/backup-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = adminRoute(async (request: Request) => {
  try {
    assertBackupOrigin(request);
    return Response.json(await backups().createUpload(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return backupError(error); }
});
