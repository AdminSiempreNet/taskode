import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { PostgresRepository } from "./postgres";
import { databaseUrl, databaseSchema } from "./database";
import { BackupManager } from "./backups";
import { createBackupStorage } from "./s3-backup-storage";
const globalDatabase = globalThis as typeof globalThis & {
  taskodeRepository?: PostgresRepository;
  taskodeBackups?: BackupManager;
};
export function repository(): PostgresRepository {
  const previous = globalDatabase.taskodeRepository;
  // Turbopack compiles pages and route handlers separately. Constructor identity
  // can differ between those bundles even when they share the same contract.
  if (previous && previous.cacheVersion !== PostgresRepository.cacheVersion) {
    globalDatabase.taskodeRepository = undefined;
    globalDatabase.taskodeBackups = undefined;
    void previous
      .close()
      .catch(() => console.error("No se pudo cerrar la conexión anterior."));
  }
  return (globalDatabase.taskodeRepository ??= new PostgresRepository(
    databaseUrl(),
    { schema: databaseSchema() },
  ));
}
export function backups() {
  const repo = repository();
  if (globalDatabase.taskodeBackups) return globalDatabase.taskodeBackups;
  const storage = createBackupStorage();
  return (globalDatabase.taskodeBackups ??= new BackupManager(
    repo,
    resolve(
      /* turbopackIgnore: true */ storage ? tmpdir() : process.env.BACKUP_DIR || "./data/backups",
    ),
    storage,
  ));
}
