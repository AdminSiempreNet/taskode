import type { Command } from "../lib/validation";
import type { Actor, ImportReport, Workspace } from "../lib/types";

// UI and HTTP contracts remain independent of the database implementation.
export interface WorkspaceRepository {
  getWorkspace(actor: Actor): Promise<Workspace>;
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
