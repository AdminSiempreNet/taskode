import { adminRoute } from "@/server/access";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repository, backups } from "@/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handleGET(_request: Request) {
  if (process.env.VERCEL === "1" || process.env.BACKUP_STORAGE === "s3") {
    try {
      const manager = backups();
      const backup = await manager.create();
      return new Response(null, { status: 302, headers: { Location: (await manager.downloadUrl(backup.id))!, "Cache-Control": "no-store" } });
    } catch {
      return Response.json({ error: "No se pudo generar el respaldo." }, { status: 500 });
    }
  }
  const dir = await mkdtemp(join(tmpdir(), "brote-backup-"));
  try {
    const path = join(dir, "backup.brote-backup.json");
    const repo = repository();
    await repo.exclusiveBackup(() => repo.exportBackup(path));
    const bytes = await readFile(/* turbopackIgnore: true */ path);
    return new Response(bytes, {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="brote-${new Date().toISOString().slice(0, 10)}.brote-backup.json"`,
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

export const GET = adminRoute(handleGET);
