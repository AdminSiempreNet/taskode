import { randomUUID } from "node:crypto";
import {
  S3Client, ListObjectsV2Command, HeadObjectCommand, GetObjectCommand,
  PutObjectCommand, DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { MAX_BACKUP_BYTES, type BackupFile } from "../lib/backups";
import { backupName, type BackupStorage } from "./backup-storage";
import { DomainError } from "./repository";

export function s3BackupConfig(env: Record<string, string | undefined> = process.env) {
  const required = (key: string) => {
    if (!env[key]) throw new Error(`Configura ${key} para los respaldos S3.`);
    return env[key]!;
  };
  const endpoint = required("S3_ENDPOINT");
  if (new URL(endpoint).protocol !== "https:") throw new Error("S3_ENDPOINT debe usar HTTPS.");
  const prefix = required("S3_PREFIX");
  if (!/^[a-zA-Z0-9/_-]+\/$/.test(prefix) || prefix.startsWith("/"))
    throw new Error("S3_PREFIX debe ser una ruta relativa terminada en /.");
  if (env.S3_FORCE_PATH_STYLE && !["true", "false"].includes(env.S3_FORCE_PATH_STYLE))
    throw new Error("S3_FORCE_PATH_STYLE debe ser true o false.");
  return {
    bucket: required("S3_BUCKET"), prefix,
    client: {
      endpoint, region: required("S3_REGION"),
      credentials: { accessKeyId: required("S3_ACCESS_KEY_ID"), secretAccessKey: required("S3_SECRET_ACCESS_KEY") },
      forcePathStyle: env.S3_FORCE_PATH_STYLE === "true",
      // Only send checksums when required, for compatibility with R2 and B2.
      requestChecksumCalculation: "WHEN_REQUIRED" as const,
      responseChecksumValidation: "WHEN_REQUIRED" as const,
      maxAttempts: 3,
      requestHandler: { connectionTimeout: 5000, requestTimeout: 30000 },
    },
  };
}

export function createBackupStorage(): BackupStorage | undefined {
  const driver = process.env.BACKUP_STORAGE || (process.env.VERCEL === "1" ? "s3" : "filesystem");
  if (driver === "s3") {
    const config = s3BackupConfig();
    return new S3BackupStorage(new S3Client(config.client), config.bucket, config.prefix);
  }
  if (driver !== "filesystem") throw new Error("BACKUP_STORAGE debe ser filesystem o s3.");
  if (process.env.VERCEL === "1") throw new Error("Vercel requiere BACKUP_STORAGE=s3 para conservar los respaldos.");
  return undefined;
}

export class S3BackupStorage implements BackupStorage {
  constructor(private client: S3Client, private bucket: string, private prefix: string) {}
  private key(id: string) {
    if (!backupName.test(id)) throw new DomainError("El respaldo no existe.", 404);
    return `${this.prefix}backups/${id}`;
  }
  private uploadKey(id: string) {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id))
      throw new DomainError("La carga temporal no es válida.");
    return `${this.prefix}uploads/${id}.json`;
  }
  private file(id: string, size: number): BackupFile {
    const match = id.match(/^brote-(manual|before-restore)-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z-/)!;
    return { id, size, kind: match[1] as BackupFile["kind"], createdAt: `${match[2]}T${match[3]}:${match[4]}:${match[5]}.${match[6]}Z` };
  }
  private rethrow(error: unknown): never {
    if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404)
      throw new DomainError("El respaldo no existe.", 404);
    throw error;
  }
  async list() {
    const files: BackupFile[] = [];
    const prefix = `${this.prefix}backups/`;
    let token: string | undefined;
    do {
      const page = await this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }));
      for (const item of page.Contents || []) {
        const id = item.Key?.slice(prefix.length);
        if (id && backupName.test(id)) files.push(this.file(id, item.Size || 0));
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return files.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  }
  async metadata(id: string) {
    try {
      const object = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: this.key(id) }));
      return this.file(id, object.ContentLength || 0);
    } catch (error) { return this.rethrow(error); }
  }
  private async readKey(key: string) {
    try {
      const object = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!object.Body) throw new DomainError("El respaldo está vacío.");
      if (!object.ContentLength || object.ContentLength > MAX_BACKUP_BYTES) {
        (object.Body as { destroy?: () => void }).destroy?.();
        throw new DomainError("Adjunta un respaldo JSON de Brote de hasta 100 MB.", 413);
      }
      const bytes = Buffer.from(await object.Body.transformToByteArray());
      if (bytes.length > MAX_BACKUP_BYTES) throw new DomainError("El respaldo supera los 100 MB.", 413);
      return bytes;
    } catch (error) { return this.rethrow(error); }
  }
  async read(id: string) { return this.readKey(this.key(id)); }
  async write(file: BackupFile, bytes: Buffer) {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: this.key(file.id), Body: bytes, ContentType: "application/json" }));
  }
  async delete(id: string) {
    await this.metadata(id);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.key(id) }));
  }
  downloadUrl(id: string) {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: this.key(id), ResponseContentDisposition: `attachment; filename="${id}"` }), { expiresIn: 300 });
  }
  async createUpload() {
    const id = randomUUID();
    const url = await getSignedUrl(this.client, new PutObjectCommand({ Bucket: this.bucket, Key: this.uploadKey(id), ContentType: "application/json" }), { expiresIn: 300 });
    return { id, url };
  }
  async readUpload(id: string) { return this.readKey(this.uploadKey(id)); }
  async deleteUpload(id: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.uploadKey(id) }));
  }
}
