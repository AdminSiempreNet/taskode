import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { PostgresRepository } from "./postgres";
import { databaseUrl, databaseSchema } from "./database";
import { BackupManager } from "./backups";
import { createBackupStorage } from "./s3-backup-storage";
const globalDatabase = globalThis as typeof globalThis & {
  broteRepository?: PostgresRepository;
  broteBackups?: BackupManager;
};
export function repository(): PostgresRepository {
  const previous = globalDatabase.broteRepository;
  if (previous && previous.cacheVersion !== PostgresRepository.cacheVersion) {
    globalDatabase.broteRepository = undefined;
    globalDatabase.broteBackups = undefined;
    void previous
      .close()
      .catch(() => console.error("No se pudo cerrar la conexión anterior."));
  }
  return (globalDatabase.broteRepository ??= new PostgresRepository(
    databaseUrl(),
    { schema: databaseSchema() },
  ));
}
export function backups() {
  const repo = repository();
  if (globalDatabase.broteBackups) return globalDatabase.broteBackups;
  const storage = createBackupStorage();
  return (globalDatabase.broteBackups ??= new BackupManager(
    repo,
    resolve(
      /* turbopackIgnore: true */ storage ? tmpdir() : process.env.BACKUP_DIR || "./data/backups",
    ),
    storage,
  ));
}
