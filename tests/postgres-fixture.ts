import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { PostgresRepository } from "../src/server/postgres";
import { migrationsFolder } from "../src/server/migration-info";

loadEnvConfig(process.cwd());
export function testDatabaseUrl() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url)
    throw new Error(
      "Configura TEST_DATABASE_URL; las pruebas nunca utilizan DATABASE_URL como alternativa.",
    );
  if (
    url === process.env.DATABASE_URL ||
    !new URL(url).pathname.endsWith("_test")
  )
    throw new Error(
      "TEST_DATABASE_URL debe apuntar a una base dedicada cuyo nombre termine en _test.",
    );
  return url;
}
export async function createEmptyRepository() {
  const connectionString = testDatabaseUrl();
  const schema = `brote_test_${randomUUID().replaceAll("-", "")}`;
  const dropSchema = async () => {
    if (!/^brote_test_[a-f0-9]{32}$/.test(schema))
      throw new Error("Esquema de prueba inválido.");
    const cleanup = new Pool({
      connectionString,
      max: 1,
      connectionTimeoutMillis: 5000,
    });
    try {
      await cleanup.query(`drop schema if exists "${schema}" cascade`);
    } finally {
      await cleanup.end();
    }
  };
  const bootstrap = new Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 5000,
  });
  try {
    await bootstrap.query(`create schema "${schema}"`);
  } finally {
    await bootstrap.end();
  }
  const pool = new Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 5000,
    options: `-c search_path=${schema}`,
  });
  try {
    await migrate(drizzle(pool), {
      migrationsFolder: migrationsFolder(),
      migrationsSchema: schema,
    });
  } catch (error) {
    await dropSchema();
    throw error;
  } finally {
    await pool.end();
  }
  const repo = new PostgresRepository(connectionString, { schema, max: 3 });
  const close = repo.close.bind(repo);
  let closed = false;
  repo.close = async () => {
    if (closed) return;
    closed = true;
    try {
      await close();
    } finally {
      await dropSchema();
    }
  };
  try {
    await repo.store.ready;
  } catch (error) {
    await repo.close();
    throw error;
  }
  return repo;
}
export async function assertIntegrity(repo: PostgresRepository) {
  const result = await repo.store.pool.query(
    "select conname from pg_constraint where connamespace = $1::regnamespace and not convalidated",
    [repo.store.schemaName],
  );
  if (result.rows.length)
    throw new Error("Hay restricciones sin validar en PostgreSQL.");
}
