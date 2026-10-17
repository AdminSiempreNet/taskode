import { resolve } from "node:path";
import { PostgresRepository } from "./postgres";
import { databaseUrl, databaseSchema } from "./database";
import { BackupManager } from "./backups";
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
  return (globalDatabase.broteBackups ??= new BackupManager(
    repo,
    resolve(
      /* turbopackIgnore: true */ process.env.BACKUP_DIR || "./data/backups",
    ),
  ));
}
