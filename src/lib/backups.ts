export const RESTORE_CONFIRMATION = "RESTAURAR";
export const MAX_BACKUP_BYTES = 100 * 1024 * 1024;

export interface BackupFile {
  id: string;
  createdAt: string;
  size: number;
  kind: "manual" | "before-restore";
}
