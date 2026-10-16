import { resolve } from "node:path";
import { SqliteRepository } from "./sqlite";
import type { WorkspaceRepository } from "./repository";
import { BackupManager } from "./backups";
const globalDatabase = globalThis as typeof globalThis & {
  broteRepository?: WorkspaceRepository;
  broteBackups?: BackupManager;
};
export function databasePath() {
  return resolve(
    /* turbopackIgnore: true */ process.env.DATABASE_PATH ||
      "./data/brote.sqlite",
  );
}
export function repository(): WorkspaceRepository {
  return (globalDatabase.broteRepository ??= new SqliteRepository(
    databasePath(),
    process.env.SEED_DEMO !== "0",
  ));
}
export function backups() {
  return (globalDatabase.broteBackups ??= new BackupManager(
    repository(),
    databasePath(),
  ));
}
