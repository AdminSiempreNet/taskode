import { adminRoute } from "@/server/access";
import { backups } from "@/server";
import {
  assertBackupOrigin,
  backupError,
  restoreForm,
} from "@/server/backup-http";
import { DomainError } from "@/server/repository";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handlePOST(request: Request) {
  try {
    assertBackupOrigin(request);
    const form = await restoreForm(request);
    const backupId = form.get("backupId");
    const file = form.get("file");
    const confirmation = form.get("confirmation");
    const previous = form.get("backupBeforeRestore");
    if (
      typeof confirmation !== "string" ||
      !["true", "false"].includes(String(previous))
    )
      throw new DomainError(
        "Confirma la restauración e indica si deseas un respaldo previo.",
      );
    if (
      (typeof backupId === "string" && backupId.length > 0) ===
      (file instanceof File && file.size > 0)
    )
      throw new DomainError(
        "Selecciona una copia del servidor o adjunta un archivo de respaldo.",
      );
    const source =
      typeof backupId === "string" && backupId.length > 0
        ? { backupId }
        : { file: new Uint8Array(await (file as File).arrayBuffer()) };
    return Response.json(
      await backups().restore(source, confirmation, previous === "true"),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return backupError(error);
  }
}

export const POST = adminRoute(handlePOST);
