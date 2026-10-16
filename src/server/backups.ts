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
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  MAX_BACKUP_BYTES,
  RESTORE_CONFIRMATION,
  type BackupFile,
} from "../lib/backups";
import { DomainError, type WorkspaceRepository } from "./repository";

const backupName =
  /^brote-(manual|before-restore)-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-f0-9-]{36}\.sqlite$/;
type RestoreSource =
  { backupId: string; file?: never } | { file: Uint8Array; backupId?: never };

export class BackupManager {
  readonly directory: string;
  private busy = false;
  constructor(
    private repository: WorkspaceRepository,
    databasePath: string,
  ) {
    this.directory = join(dirname(databasePath), "backups");
  }
  private async exclusive<T>(action: () => Promise<T>): Promise<T> {
    if (this.busy)
      throw new DomainError(
        "Hay una operación de respaldo en curso. Espera a que termine.",
        409,
      );
    this.busy = true;
    try {
      return await action();
    } finally {
      this.busy = false;
    }
  }
  private async metadata(id: string): Promise<BackupFile> {
    if (!backupName.test(id))
      throw new DomainError("El respaldo no existe.", 404);
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
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const id = `brote-${kind}-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}.sqlite`;
    const pending = join(this.directory, `.pending-${randomUUID()}.sqlite`);
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
  download(id: string) {
    return this.exclusive(async () => {
      await this.metadata(id);
      const path = join(this.directory, id);
      return readFile(/* turbopackIgnore: true */ path);
    });
  }
  delete(id: string) {
    return this.exclusive(async () => {
      await this.metadata(id);
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
          "Adjunta un respaldo SQLite de hasta 100 MB.",
          413,
        );
      const dir = await mkdtemp(join(tmpdir(), "brote-restore-"));
      let safetyBackup: BackupFile | undefined;
      try {
        const path = join(dir, "restore.sqlite");
        if (source.backupId !== undefined) {
          await this.metadata(source.backupId);
          await copyFile(join(this.directory, source.backupId), path);
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
      }
    });
  }
}
