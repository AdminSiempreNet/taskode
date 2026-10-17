import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { databaseSchema, databaseUrl } from "../src/server/database";
import { migrationsFolder } from "../src/server/migration-info";

loadEnvConfig(process.cwd());
async function main() {
  const schema = databaseSchema();
  const pool = new Pool({
    connectionString: databaseUrl(),
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
      console.log("Migraciones PostgreSQL de Brote aplicadas.");
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
