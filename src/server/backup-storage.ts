import type { BackupFile } from "../lib/backups";

// Keep access to files created before the rename, both locally and in S3.
export const backupName = /^(taskode|brote)-(manual|before-restore)-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-f0-9-]{36}\.\1-backup\.json$/;

export interface BackupStorage {
  list(): Promise<BackupFile[]>;
  metadata(id: string): Promise<BackupFile>;
  read(id: string): Promise<Buffer<ArrayBuffer>>;
  write(file: BackupFile, bytes: Buffer): Promise<void>;
  delete(id: string): Promise<void>;
  downloadUrl?(id: string): Promise<string>;
  createUpload?(): Promise<{ id: string; url: string }>;
  readUpload?(id: string): Promise<Buffer<ArrayBuffer>>;
  deleteUpload?(id: string): Promise<void>;
}
