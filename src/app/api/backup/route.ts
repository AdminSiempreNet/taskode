import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repository } from "@/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  const dir = await mkdtemp(join(tmpdir(), "brote-backup-"));
  try {
    const path = join(dir, "backup.sqlite");
    await repository().exportBackup(path);
    const bytes = await readFile(/* turbopackIgnore: true */ path);
    return new Response(bytes, {
      headers: {
        "Content-Type": "application/vnd.sqlite3",
        "Content-Disposition": `attachment; filename="brote-${new Date().toISOString().slice(0, 10)}.sqlite"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error(error);
    return Response.json(
      { error: "No se pudo generar el respaldo." },
      { status: 500 },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
