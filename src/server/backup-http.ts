import { DomainError, isDomainError } from "./repository";
import { MAX_BACKUP_BYTES } from "../lib/backups";

export function assertBackupOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (
        new URL(origin).host ===
        (request.headers.get("host") ?? new URL(request.url).host)
      )
        return;
    } catch {
      /* Reject invalid origins below. */
    }
    throw new DomainError("Origen no permitido.", 403);
  }
}
export function backupError(error: unknown) {
  if (isDomainError(error))
    return Response.json(
      { error: error.message },
      { status: error.status, headers: { "Cache-Control": "no-store" } },
    );
  console.error(error);
  return Response.json(
    {
      error:
        "No se pudo completar la operación de respaldo. Vuelve a intentarlo.",
    },
    { status: 500 },
  );
}
export async function restoreForm(request: Request) {
  const limit = MAX_BACKUP_BYTES + 1024 * 1024;
  if (Number(request.headers.get("content-length")) > limit)
    throw new DomainError("El respaldo supera el límite de 100 MB.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new DomainError("Falta el respaldo.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.length;
    if (size > limit) {
      await reader.cancel();
      throw new DomainError("El respaldo supera el límite de 100 MB.", 413);
    }
    chunks.push(chunk.value);
  }
  try {
    return await new Response(Buffer.concat(chunks), {
      headers: { "Content-Type": request.headers.get("content-type") ?? "" },
    }).formData();
  } catch {
    throw new DomainError("El formulario de restauración no es válido.");
  }
}
