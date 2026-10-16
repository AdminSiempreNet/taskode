import type { Command } from "../lib/validation";
import type { ImportReport, Workspace } from "../lib/types";

// The UI and HTTP layer depend on this contract; another database can replace SQLite here.
export interface WorkspaceRepository {
  getWorkspace(): Workspace | Promise<Workspace>;
  execute(
    command: Command,
  ):
    | { report?: ImportReport; createdId?: string }
    | Promise<{ report?: ImportReport; createdId?: string }>;
  exportBackup(destination: string): Promise<void>;
  restoreBackup(
    source: string,
    beforeRestore?: () => Promise<void>,
  ): Promise<void>;
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
