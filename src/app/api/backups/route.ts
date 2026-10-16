import { adminRoute } from "@/server/access";
import { backups } from "@/server";
import { assertBackupOrigin, backupError } from "@/server/backup-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handleGET(_request: Request) {
  try {
    return Response.json(
      { backups: await backups().list() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return backupError(error);
  }
}
async function handlePOST(request: Request) {
  try {
    assertBackupOrigin(request);
    return Response.json({ backup: await backups().create() }, { status: 201 });
  } catch (error) {
    return backupError(error);
  }
}

export const GET = adminRoute(handleGET);

export const POST = adminRoute(handlePOST);
