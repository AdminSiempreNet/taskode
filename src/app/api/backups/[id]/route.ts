import { backups } from "@/server";
import { assertBackupOrigin, backupError } from "@/server/backup-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const bytes = await backups().download(id);
    return new Response(bytes, {
      headers: {
        "Content-Type": "application/vnd.sqlite3",
        "Content-Disposition": `attachment; filename="${id}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return backupError(error);
  }
}
export async function DELETE(request: Request, context: Context) {
  try {
    assertBackupOrigin(request);
    await backups().delete((await context.params).id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return backupError(error);
  }
}
