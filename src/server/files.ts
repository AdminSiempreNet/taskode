import { randomUUID } from "node:crypto";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { fileTypeFromBuffer } from "file-type";
import type { Actor } from "../lib/types";
import { fileTypes } from "../lib/files";
import { files, tasks, comments } from "./schema";
import type { PostgresRepository } from "./postgres";
import { DomainError } from "./repository";
import {
  createFileStorage,
  S3FileStorage,
  type FileStorage,
} from "./file-storage";

export class FileManager {
  constructor(
    private repo: PostgresRepository,
    readonly storage: FileStorage = createFileStorage(),
  ) {}
  private async get(id: string) {
    const file = (
      await this.repo.store.db.select().from(files).where(eq(files.id, id))
    )[0];
    if (!file)
      throw new DomainError("El archivo no existe o no tienes acceso.", 404);
    return file;
  }
  private async access(actor: Actor, file: typeof files.$inferSelect) {
    await this.repo.requireProject(actor, file.projectId);
    if (file.taskId) await this.repo.requireTask(actor, file.taskId);
    else if (
      file.uploadedBy !== actor.id ||
      Date.parse(file.createdAt) < Date.now() - 86400000
    )
      throw new DomainError("La carga temporal expiró.", 404);
  }
  async cleanup() {
    const expired = await this.repo.store.db
      .select()
      .from(files)
      .where(
        or(
          eq(files.status, "deleted"),
          and(
            isNull(files.taskId),
            lt(files.createdAt, new Date(Date.now() - 86400000).toISOString()),
          ),
        ),
      )
      .limit(50);
    for (const file of expired) {
      await this.storage.remove(file.id, true);
      await this.storage.remove(file.id);
      await this.repo.store.db
        .delete(files)
        .where(and(eq(files.id, file.id), isNull(files.taskId)));
    }
  }
  async begin(
    actor: Actor,
    input: {
      projectId: string;
      taskId?: string;
      name: string;
      size: number;
      purpose: "image" | "document";
    },
  ) {
    return this.repo.store.transaction(async () => {
      await this.repo.requireProject(actor, input.projectId);
      if (input.taskId) {
        const { task } = await this.repo.requireTask(actor, input.taskId);
        if (task.projectId !== input.projectId)
          throw new DomainError("La tarea pertenece a otro proyecto.");
      }
      const limit = (await this.repo.store.state()).maxAttachmentBytes;
      if (
        !Number.isSafeInteger(input.size) ||
        input.size <= 0 ||
        input.size > limit
      )
        throw new DomainError(
          `El archivo debe tener entre 1 byte y ${limit / 1048576} MB.`,
          413,
        );
      const name = input.name.replace(/[\\/\x00-\x1f\x7f]/g, "_").slice(-180);
      const ext = name.split(".").at(-1)!.toLowerCase();
      const mimeType = fileTypes[ext];
      if (
        !mimeType ||
        (input.purpose === "image" && !mimeType.startsWith("image/"))
      )
        throw new DomainError("El tipo de archivo no está permitido.");
      await this.cleanup();
      const id = randomUUID();
      await this.repo.store.db
        .insert(files)
        .values({
          id,
          projectId: input.projectId,
          taskId: null,
          uploadedBy: actor.id,
          name,
          mimeType,
          size: input.size,
          storageKey: id,
          purpose: input.purpose,
          createdAt: new Date().toISOString(),
        });
      return {
        id,
        url: await this.storage.createUpload(id, mimeType, input.size),
        mimeType,
        limit,
      };
    });
  }
  async put(actor: Actor, id: string, request: Request) {
    return this.repo.store.transaction(async () => {
      const file = await this.get(id);
      await this.access(actor, file);
      if (file.status !== "pending" || file.uploadedBy !== actor.id)
        throw new DomainError("La carga ya se completó.", 409);
      const max = Math.min(
        file.size,
        (await this.repo.store.state()).maxAttachmentBytes,
      );
      if (Number(request.headers.get("content-length")) > max)
        throw new DomainError("El archivo supera el límite permitido.", 413);
      const reader = request.body?.getReader();
      if (!reader) throw new DomainError("Falta el archivo.");
      const chunks: Buffer[] = [];
      let size = 0;
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.length;
        if (size > max) {
          await reader.cancel();
          throw new DomainError("El archivo supera el límite permitido.", 413);
        }
        chunks.push(Buffer.from(next.value));
      }
      await this.storage.putPending(id, Buffer.concat(chunks));
    });
  }
  async complete(actor: Actor, id: string, taskId?: string) {
    const result = await this.repo.store.transaction(async () => {
      const file = await this.get(id);
      await this.access(actor, file);
      if (file.uploadedBy !== actor.id)
        throw new DomainError("No puedes finalizar esta carga.", 403);
      if (taskId) {
        const { task } = await this.repo.requireTask(actor, taskId);
        if (task.projectId !== file.projectId)
          throw new DomainError("El archivo pertenece a otro proyecto.");
      }
      if (file.status === "ready")
        return {
          id: file.id,
          name: file.name,
          mimeType: file.mimeType,
          size: file.size,
        };
      const max = Math.min(
        file.size,
        (await this.repo.store.state()).maxAttachmentBytes,
      );
      const published = await this.storage.exists(id);
      const bytes = published
        ? await this.storage.read(id)
        : await this.storage.readPending(id, max);
      if (bytes.length > max)
        throw new DomainError("El archivo supera el límite permitido.", 413);
      if (bytes.length !== file.size)
        throw new DomainError("La carga está incompleta.");
      const type = await fileTypeFromBuffer(bytes).catch(() => undefined);
      const ole = bytes
        .subarray(0, 8)
        .equals(Buffer.from("d0cf11e0a1b11ae1", "hex"));
      const legacyOffice =
        ole &&
        ((file.mimeType === fileTypes.doc &&
          bytes.includes(Buffer.from("WordDocument", "utf16le"))) ||
          (file.mimeType === fileTypes.xls &&
            ["Workbook", "Book"].some((n) =>
              bytes.includes(Buffer.from(n, "utf16le")),
            )));
      if (!legacyOffice && type?.mime !== file.mimeType)
        throw new DomainError(
          "El contenido no coincide con el tipo de archivo.",
        );
      if (!published) {
        if (this.storage instanceof S3FileStorage)
          await this.storage.publishBytes(id, bytes, file.mimeType);
        else await this.storage.publish(id, file.mimeType);
      }
      await this.repo.store.db
        .update(files)
        .set({ status: "ready", taskId: taskId ?? null })
        .where(eq(files.id, id));
      return { id, name: file.name, mimeType: file.mimeType, size: file.size };
    });
    await this.storage.remove(id, true).catch(() => {});
    return result;
  }
  async content(actor: Actor, id: string, download: boolean) {
    return this.repo.store.snapshot(async () => {
      const file = await this.get(id);
      await this.access(actor, file);
      if (file.status !== "ready" || !(await this.storage.exists(id)))
        throw new DomainError(
          "El archivo físico no está disponible. Restaura también la copia del almacenamiento.",
          404,
        );
      const inline =
        !download &&
        (file.mimeType.startsWith("image/") ||
          file.mimeType === "application/pdf");
      const url = await this.storage.downloadUrl(id, file.name, inline);
      if (url)
        return new Response(null, {
          status: 302,
          headers: {
            Location: url,
            "Cache-Control": "private, no-store",
            "Referrer-Policy": "no-referrer",
          },
        });
      return new Response(new Uint8Array(await this.storage.read(id)), {
        headers: {
          "Content-Type": file.mimeType,
          "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name).replace(/'/g, "%27")}`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    });
  }
  async remove(actor: Actor, id: string) {
    await this.repo.store.transaction(async () => {
      const file = await this.get(id);
      await this.access(actor, file);
      if (file.taskId) {
        const task = (
          await this.repo.store.db
            .select()
            .from(tasks)
            .where(eq(tasks.id, file.taskId))
        )[0];
        const notes = await this.repo.store.db
          .select()
          .from(comments)
          .where(eq(comments.taskId, file.taskId));
        if (
          [task.description, ...notes.map((c) => c.content)].some((c) =>
            c.includes(`/api/files/${id}/content`),
          )
        )
          throw new DomainError(
            "Retira primero la imagen de la descripción y los comentarios.",
            409,
          );
      }
      await this.repo.store.db
        .update(files)
        .set({ status: "deleted", taskId: null })
        .where(eq(files.id, id));
    });
    // Revoke access transactionally before touching storage; failed physical cleanup is retried later.
    try {
      await this.storage.remove(id, true);
      await this.storage.remove(id);
      await this.repo.store.db
        .delete(files)
        .where(and(eq(files.id, id), eq(files.status, "deleted")));
    } catch {
      console.error(
        "La limpieza de un archivo eliminado se reintentará en la próxima carga.",
      );
    }
  }
}
