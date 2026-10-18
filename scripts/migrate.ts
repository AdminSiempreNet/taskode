// Keep advisory lock identifiers stable across the Taskode rename to coordinate with existing processes.
import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { databaseSchema, databaseUrl } from "../src/server/database";
import { migrationsFolder } from "../src/server/migration-info";
import { databasePoolConfig } from "../src/server/database-config";

const development = process.argv.includes("--development");
loadEnvConfig(process.cwd(), development);
async function main() {
  const schema = databaseSchema();
  if (development && !["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(databaseUrl()).hostname))
    throw new Error("La migración --development requiere una base PostgreSQL local.");
  const pool = new Pool({
    ...databasePoolConfig(databaseUrl()),
    max: 1,
    connectionTimeoutMillis: 5000,
    options: `-c search_path=${schema}`,
  });
  try {
    const client = await pool.connect();
    try {
      await client.query(
        "select pg_advisory_lock(hashtextextended(current_database() || ':' || $1 || ':brote-migrations', 0))",
        [schema],
      );
      await migrate(drizzle(client), {
        migrationsFolder: migrationsFolder(),
        migrationsSchema: schema,
      });
      console.log("Migraciones PostgreSQL de Taskode aplicadas.");
    } finally {
      client.release(true);
    }
  } finally {
    await pool.end();
  }
}
main().catch((error) => {
  console.error(
    error instanceof Error
      ? error.message
      : "No se pudieron aplicar las migraciones.",
  );
  process.exitCode = 1;
});
