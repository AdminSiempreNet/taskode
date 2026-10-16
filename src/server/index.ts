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
  return (globalDatabase.broteRepository ??= new SqliteRepository(
    databasePath(),
  ));
}
export function backups() {
  return (globalDatabase.broteBackups ??= new BackupManager(
    repository(),
    databasePath(),
  ));
}
