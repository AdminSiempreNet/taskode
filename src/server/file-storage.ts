import {
  mkdir,
  readFile,
  writeFile,
  rename,
  unlink,
  stat,
} from "node:fs/promises";
import { resolve, join } from "node:path";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3BackupConfig } from "./s3-backup-storage";
import { DomainError } from "./repository";

export interface FileStorage {
  createUpload(id: string, mime: string, size: number): Promise<string | null>;
  putPending(id: string, bytes: Buffer): Promise<void>;
  readPending(id: string, maxBytes: number): Promise<Buffer>;
  publish(id: string, mime: string): Promise<void>;
  read(id: string): Promise<Buffer>;
  downloadUrl(
    id: string,
    name: string,
    inline: boolean,
  ): Promise<string | null>;
  remove(id: string, pending?: boolean): Promise<void>;
  exists(id: string): Promise<boolean>;
}
function checked(id: string) {
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      id,
    )
  )
    throw new DomainError("Archivo inválido.", 404);
  return id;
}
export class LocalFileStorage implements FileStorage {
  constructor(
    private directory = resolve(
      /* turbopackIgnore: true */ process.env.ATTACHMENT_DIR ||
        "./data/attachments",
    ),
  ) {}
  private path(id: string, pending = false) {
    return join(this.directory, `${checked(id)}${pending ? ".pending" : ""}`);
  }
  async createUpload() {
    return null;
  }
  async putPending(id: string, bytes: Buffer) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await writeFile(this.path(id, true), bytes, { flag: "wx", mode: 0o600 });
  }
  async readPending(id: string, max: number) {
    if ((await stat(this.path(id, true))).size > max)
      throw new DomainError("El archivo supera el límite permitido.", 413);
    return readFile(this.path(id, true));
  }
  async publish(id: string) {
    await rename(this.path(id, true), this.path(id));
  }
  async read(id: string) {
    return readFile(this.path(id));
  }
  async downloadUrl() {
    return null;
  }
  async remove(id: string, pending = false) {
    await unlink(this.path(id, pending)).catch((e) => {
      if (e.code !== "ENOENT") throw e;
    });
  }
  async exists(id: string) {
    try {
      return (await stat(this.path(id))).isFile();
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw e;
    }
  }
}
export class S3FileStorage implements FileStorage {
  constructor(
    private client: S3Client,
    private bucket: string,
    private prefix: string,
  ) {}
  private key(id: string, pending = false) {
    return `${this.prefix}attachments/${pending ? "pending/" : ""}${checked(id)}`;
  }
  async createUpload(id: string, mime: string, size: number) {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.key(id, true),
        ContentType: mime,
        ContentLength: size,
      }),
      { expiresIn: 300 },
    );
  }
  async putPending() {
    throw new DomainError("Utiliza la carga directa al almacenamiento.");
  }
  async readPending(id: string, max: number) {
    const head = await this.client.send(
      new HeadObjectCommand({ Bucket: this.bucket, Key: this.key(id, true) }),
    );
    if (!head.ContentLength || head.ContentLength > max)
      throw new DomainError("El archivo supera el límite permitido.", 413);
    const object = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: this.key(id, true),
        IfMatch: head.ETag,
      }),
    );
    if (!object.Body) throw new DomainError("La carga está vacía.");
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of object.Body as AsyncIterable<Uint8Array>) {
      size += chunk.length;
      if (size > max) {
        (object.Body as { destroy?: () => void }).destroy?.();
        throw new DomainError("El archivo supera el límite permitido.", 413);
      }
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  // Publish validated bytes, rather than copying a staging object which a still-valid PUT could change.
  async publishBytes(id: string, bytes: Buffer, mime: string) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.key(id),
        Body: bytes,
        ContentType: mime,
        IfNoneMatch: "*",
      }),
    );
  }
  async publish() {
    throw new Error("S3 publication requires validated bytes.");
  }
  async read(id: string) {
    const o = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: this.key(id) }),
    );
    return Buffer.from(await o.Body!.transformToByteArray());
  }
  async downloadUrl(id: string, name: string, inline: boolean) {
    const disposition = `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name).replace(/'/g, "%27")}`;
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: this.key(id),
        ResponseContentDisposition: disposition,
      }),
      { expiresIn: 60 },
    );
  }
  async remove(id: string, pending = false) {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: this.key(id, pending),
      }),
    );
  }
  async exists(id: string) {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: this.key(id) }),
      );
      return true;
    } catch (e) {
      if (
        (e as { $metadata?: { httpStatusCode?: number } }).$metadata
          ?.httpStatusCode === 404
      )
        return false;
      throw e;
    }
  }
}
export function createFileStorage(): FileStorage {
  const driver = process.env.ATTACHMENT_STORAGE || "filesystem";
  if (driver === "s3") {
    const c = s3BackupConfig();
    return new S3FileStorage(new S3Client(c.client), c.bucket, c.prefix);
  }
  if (driver !== "filesystem")
    throw new Error("ATTACHMENT_STORAGE debe ser filesystem o s3.");
  return new LocalFileStorage();
}
