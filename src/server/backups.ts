import { randomUUID } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  MAX_BACKUP_BYTES,
  RESTORE_CONFIRMATION,
  type BackupFile,
} from "../lib/backups";
import { DomainError, type WorkspaceRepository } from "./repository";
import { backupName, type BackupStorage } from "./backup-storage";

type RestoreSource =
  | { backupId: string; file?: never; uploadId?: never }
  | { file: Uint8Array; backupId?: never; uploadId?: never }
  | { uploadId: string; backupId?: never; file?: never };

export class BackupManager {
  readonly directory: string;
  private busy = false;
  constructor(
    private repository: WorkspaceRepository,
    backupDirectory: string,
    private storage?: BackupStorage,
  ) {
    this.directory = backupDirectory;
  }
  private async exclusive<T>(action: () => Promise<T>): Promise<T> {
    if (this.busy)
      throw new DomainError(
        "Hay una operación de respaldo en curso. Espera a que termine.",
        409,
      );
    this.busy = true;
    try {
      return await this.repository.exclusiveBackup(action);
    } finally {
      this.busy = false;
    }
  }
  private async metadata(id: string): Promise<BackupFile> {
    if (!backupName.test(id))
      throw new DomainError("El respaldo no existe.", 404);
    if (this.storage) return this.storage.metadata(id);
    try {
      // Backups are runtime data, not assets for Turbopack to trace or watch.
      const path = join(this.directory, id);
      const stat = await lstat(/* turbopackIgnore: true */ path);
      if (!stat.isFile()) throw new DomainError("El respaldo no existe.", 404);
      return {
        id,
        createdAt: stat.mtime.toISOString(),
        size: stat.size,
        kind: id.startsWith("brote-before-restore-")
          ? "before-restore"
          : "manual",
      };
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        throw new DomainError("El respaldo no existe.", 404);
      throw error;
    }
  }
  async list(): Promise<BackupFile[]> {
    if (this.storage) return this.storage.list();
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const directory = this.directory;
    const files = await Promise.all(
      (await readdir(/* turbopackIgnore: true */ directory))
        .filter((id) => backupName.test(id))
        .map(async (id) => {
          try {
            return await this.metadata(id);
          } catch (error) {
            if (error instanceof DomainError && error.status === 404)
              return null;
            throw error;
          }
        }),
    );
    return files
      .filter((file): file is BackupFile => file !== null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  private async save(kind: BackupFile["kind"]): Promise<BackupFile> {
    if (this.storage) {
      const directory = await mkdtemp(join(tmpdir(), "brote-export-"));
      try {
        const path = join(directory, "backup.json");
        await this.repository.exportBackup(path);
        const bytes = await readFile(/* turbopackIgnore: true */ path);
        const createdAt = new Date().toISOString();
        const file: BackupFile = {
          id: `brote-${kind}-${createdAt.replace(/[:.]/g, "-")}-${randomUUID()}.brote-backup.json`,
          kind, createdAt, size: bytes.length,
        };
        await this.storage.write(file, bytes);
        return file;
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const id = `brote-${kind}-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}.brote-backup.json`;
    const pending = join(
      this.directory,
      `.pending-${randomUUID()}.brote-backup.json`,
    );
    try {
      await this.repository.exportBackup(pending);
      await rename(pending, join(this.directory, id));
      return await this.metadata(id);
    } finally {
      await rm(pending, { force: true });
    }
  }
  create() {
    return this.exclusive(() => this.save("manual"));
  }
  async downloadUrl(id: string) {
    return this.exclusive(async () => {
      await this.metadata(id);
      return this.storage?.downloadUrl?.(id) ?? null;
    });
  }
  createUpload() {
    if (!this.storage?.createUpload)
      throw new DomainError("La carga directa requiere almacenamiento S3.", 400);
    return this.storage.createUpload();
  }
  download(id: string) {
    return this.exclusive(async () => {
      await this.metadata(id);
      if (this.storage) return this.storage.read(id);
      const path = join(this.directory, id);
      return readFile(/* turbopackIgnore: true */ path);
    });
  }
  delete(id: string) {
    return this.exclusive(async () => {
      await this.metadata(id);
      if (this.storage) return this.storage.delete(id);
      await rm(join(this.directory, id));
    });
  }
  restore(
    source: RestoreSource,
    confirmation: string,
    backupBeforeRestore: boolean,
  ) {
    return this.exclusive(async () => {
      if (confirmation !== RESTORE_CONFIRMATION)
        throw new DomainError(
          `Escribe ${RESTORE_CONFIRMATION} para confirmar la restauración.`,
        );
      if (typeof backupBeforeRestore !== "boolean")
        throw new DomainError("Indica si deseas crear un respaldo previo.");
      if (
        source.file &&
        (!source.file.length || source.file.length > MAX_BACKUP_BYTES)
      )
        throw new DomainError(
          "Adjunta un respaldo JSON de Brote de hasta 100 MB.",
          413,
        );
      const dir = await mkdtemp(join(tmpdir(), "brote-restore-"));
      let safetyBackup: BackupFile | undefined;
      try {
        const path = join(dir, "restore.brote-backup.json");
        if (source.uploadId !== undefined) {
          if (!this.storage?.readUpload) throw new DomainError("La carga directa requiere almacenamiento S3.");
          await writeFile(path, await this.storage.readUpload(source.uploadId), { flag: "wx", mode: 0o600 });
        } else if (source.backupId !== undefined) {
          await this.metadata(source.backupId);
          if (this.storage)
            await writeFile(path, await this.storage.read(source.backupId), { flag: "wx", mode: 0o600 });
          else await copyFile(join(this.directory, source.backupId), path);
        } else {
          await writeFile(path, source.file!, { flag: "wx", mode: 0o600 });
        }
        await this.repository.restoreBackup(path, async () => {
          if (backupBeforeRestore)
            safetyBackup = await this.save("before-restore");
        });
        return { safetyBackup };
      } finally {
        await rm(dir, { recursive: true, force: true });
        if (source.uploadId && this.storage?.deleteUpload)
          await this.storage.deleteUpload(source.uploadId).catch(() => console.error("No se pudo eliminar una carga temporal de respaldo."));
      }
    });
  }
}
