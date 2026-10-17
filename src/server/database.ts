import { AsyncLocalStorage } from "node:async_hooks";
import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq, sql } from "drizzle-orm";
import * as schema from "./schema";
import { expectedMigration } from "./migration-info";
import { DomainError } from "./repository";
import { databasePoolConfig } from "./database-config";
import { attachDatabasePool } from "@vercel/functions";

export type Database = NodePgDatabase<typeof schema>;
export type DatabaseOptions = { schema?: string; max?: number };
export function databaseUrl() {
  const url = process.env.DATABASE_URL;
  if (!url)
    throw new Error("Configura DATABASE_URL para conectar Brote a PostgreSQL.");
  return url;
}
export function databaseSchema(
  value = process.env.DATABASE_SCHEMA || "public",
) {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(value))
    throw new Error("DATABASE_SCHEMA no es un identificador válido.");
  return value;
}

export class DatabaseStore {
  readonly pool: Pool;
  readonly orm: Database;
  readonly schemaName: string;
  private context = new AsyncLocalStorage<Database>();
  private readiness?: Promise<void>;
  private closed = false;
  private closing?: Promise<void>;

  constructor(
    readonly connectionString: string,
    options: DatabaseOptions = {},
  ) {
    if (!/^postgres(?:ql)?:\/\//.test(connectionString))
      throw new Error("DATABASE_URL debe ser una conexión PostgreSQL.");
    this.schemaName = databaseSchema(options.schema);
    this.pool = new Pool({
      ...databasePoolConfig(connectionString),
      ...(options.max !== undefined ? { max: options.max } : {}),
      options: `-c search_path=${this.schemaName}`,
    });
    if (process.env.VERCEL === "1") attachDatabasePool(this.pool);
    this.pool.on("error", () =>
      console.error("Se perdió una conexión inactiva a PostgreSQL."),
    );
    this.orm = drizzle(this.pool, { schema });
    void this.ready.catch(() => {});
  }
  get ready(): Promise<void> {
    if (this.closed)
      return Promise.reject(new Error("La conexión PostgreSQL está cerrada."));
    return (this.readiness ??= this.checkSchema().catch((error) => {
      // A failed initial connection must not make this process unrecoverable.
      this.readiness = undefined;
      throw error;
    }));
  }
  get db() {
    return this.context.getStore() ?? this.orm;
  }
  private async checkSchema() {
    const expected = expectedMigration();
    try {
      const result = await this.pool.query<{ hash: string }>(
        `SELECT hash FROM "${this.schemaName}"."__drizzle_migrations" ORDER BY created_at DESC, id DESC LIMIT 1`,
      );
      if (result.rows[0]?.hash !== expected.hash)
        throw new Error("schema-version");
      const state = await this.orm
        .select()
        .from(schema.installation)
        .where(eq(schema.installation.id, 1));
      if (state.length !== 1) throw new Error("installation-state");
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (
        code === "42P01" ||
        (error instanceof Error &&
          ["schema-version", "installation-state"].includes(error.message))
      )
        throw new Error(
          "El esquema PostgreSQL no está actualizado. Ejecuta npm run db:migrate.",
        );
      throw error;
    }
  }
  async health() {
    await this.ready;
    await this.checkSchema();
  }
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return this.writeTransaction(fn, false);
  }
  async restore<T>(fn: () => Promise<T>): Promise<T> {
    return this.writeTransaction(fn, true);
  }
  private async writeTransaction<T>(
    fn: () => Promise<T>,
    restoring: boolean,
  ): Promise<T> {
    await this.ready;
    if (this.context.getStore()) return fn();
    return this.orm.transaction(async (tx) => {
      if (restoring) {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(current_database() || ':' || current_schema() || ':brote-restore', 0))`,
        );
      } else {
        const gate = await tx.execute<{ locked: boolean }>(
          sql`select pg_try_advisory_xact_lock_shared(hashtextextended(current_database() || ':' || current_schema() || ':brote-restore', 0)) as locked`,
        );
        if (!gate.rows[0].locked)
          throw new DomainError(
            "Hay una restauración en curso. Espera a que termine.",
            409,
          );
      }
      // Replaces the SQLite process queue with a lock shared by every process.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(current_database() || ':' || current_schema() || ':brote-write', 0))`,
      );
      return this.context.run(tx as unknown as Database, fn);
    });
  }
  async snapshot<T>(fn: () => Promise<T>): Promise<T> {
    await this.ready;
    if (this.context.getStore()) return fn();
    return this.orm.transaction(
      (tx) => this.context.run(tx as unknown as Database, fn),
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
  }
  async exclusiveOperation<T>(fn: () => Promise<T>): Promise<T> {
    await this.ready;
    const client = await this.pool.connect();
    let locked = false;
    try {
      const result = await client.query<{ locked: boolean }>(
        "select pg_try_advisory_lock(hashtextextended(current_database() || ':' || current_schema() || ':brote-backups', 0)) as locked",
      );
      locked = result.rows[0].locked;
      if (!locked)
        throw new DomainError(
          "Hay una operación de respaldo en curso. Espera a que termine.",
          409,
        );
      return await fn();
    } finally {
      try {
        if (locked)
          await client.query(
            "select pg_advisory_unlock(hashtextextended(current_database() || ':' || current_schema() || ':brote-backups', 0))",
          );
      } finally {
        client.release();
      }
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
    if (!this.closing) {
      this.closed = true;
      this.closing = (async () => {
        await this.readiness?.catch(() => {});
        await this.pool.end();
      })();
    }
    return this.closing;
  }
}
