import { resolve } from "node:path";
import { SqliteRepository } from "./sqlite";
import { BackupManager } from "./backups";
const globalDatabase = globalThis as typeof globalThis & {
  broteRepository?: SqliteRepository;
  broteBackups?: BackupManager;
};
export function databasePath() {
  return resolve(
    /* turbopackIgnore: true */ process.env.DATABASE_PATH ||
      "./data/brote.sqlite",
  );
}
export function repository(): SqliteRepository {
  const previous = globalDatabase.broteRepository;
  if (previous && previous.cacheVersion !== SqliteRepository.cacheVersion) {
    // Fast Refresh conserva globalThis incluso cuando cambia la implementación.
    globalDatabase.broteRepository = undefined;
    globalDatabase.broteBackups = undefined;
    void previous.close().catch((error) => {
      console.error("No se pudo cerrar la conexión anterior.", error);
    });
  }
  return (globalDatabase.broteRepository ??= new SqliteRepository(
    databasePath(),
  ));
}
export function backups() {
  const repo = repository();
  return (globalDatabase.broteBackups ??= new BackupManager(
    repo,
    databasePath(),
  ));
}
