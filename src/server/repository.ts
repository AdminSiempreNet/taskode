import type { Command } from "../lib/validation";
import type {
  Actor,
  Geography,
  ImportReport,
  Workspace,
  EntityKind,
  EntityDetailSnapshot,
} from "../lib/types";

// UI and HTTP contracts remain independent of the database implementation.
export interface WorkspaceReadOptions {
  includeCatalogs?: boolean;
  // Restricts the read to these projects (still subject to the actor's access).
  projectIds?: string[];
}
export interface WorkspaceRepository {
  getWorkspace(actor: Actor, options?: WorkspaceReadOptions): Promise<Workspace>;
  entityDetail(
    actor: Actor,
    kind: EntityKind,
    id: string,
    projectId?: string,
  ): Promise<EntityDetailSnapshot>;
  getGeography(actor: Actor): Promise<Geography>;
  execute(
    command: Command,
    actor: Actor,
  ): Promise<{ report?: ImportReport; createdId?: string }>;
  exportBackup(destination: string): Promise<void>;
  restoreBackup(
    source: string,
    beforeRestore?: () => Promise<void>,
  ): Promise<void>;
  exclusiveBackup<T>(action: () => Promise<T>): Promise<T>;
}
export class DomainError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

// Server components and route handlers can load different copies of this class.
export function isDomainError(error: unknown): error is DomainError {
  return (
    error instanceof Error &&
    "status" in error &&
    typeof error.status === "number" &&
    Number.isInteger(error.status) &&
    error.status >= 400 &&
    error.status < 500
  );
}
