import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { eq } from "drizzle-orm";
import * as schema from "./schema";

export type Database = LibSQLDatabase<typeof schema>;
export class DatabaseStore {
  readonly client: Client;
  readonly orm: Database;
  readonly ready: Promise<void>;
  private context = new AsyncLocalStorage<Database>();
  private queue: Promise<void> = Promise.resolve();
  constructor(readonly path: string) {
    mkdirSync(dirname(resolve(path)), { recursive: true });
    this.client = createClient({
      url: `file:${resolve(path).replaceAll("\\", "/")}`,
    });
    this.orm = drizzle(this.client, { schema });
    this.ready = this.initialize();
  }
  get db() {
    return this.context.getStore() ?? this.orm;
  }
  private async initialize() {
    await this.client.execute("PRAGMA foreign_keys=ON");
    await this.client.execute("PRAGMA busy_timeout=5000");
    const version = Number(
      (await this.client.execute("PRAGMA user_version")).rows[0].user_version,
    );
    if (version !== 0 && version !== 8)
      throw new Error(
        "La base anterior debe reiniciarse antes de usar esta versión con autenticación.",
      );
    await this.client.execute("PRAGMA journal_mode=WAL");
    await migrate(this.orm, {
      migrationsFolder: resolve(process.cwd(), "drizzle"),
    });
    await this.client.execute("PRAGMA user_version=8");
    await this.orm
      .insert(schema.installation)
      .values({ id: 1 })
      .onConflictDoNothing();
  }
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    await this.ready;
    if (this.context.getStore()) return fn();
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await this.orm.transaction(
        (tx) => this.context.run(tx as unknown as Database, fn),
        { behavior: "immediate" },
      );
    } finally {
      release();
    }
  }
  async state() {
    await this.ready;
    return (
      await this.db
        .select()
        .from(schema.installation)
        .where(eq(schema.installation.id, 1))
    )[0];
  }
  close() {
    this.client.close();
  }
}
