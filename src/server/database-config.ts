import type { PoolConfig } from "pg";

export function databaseSsl(connectionString: string): PoolConfig["ssl"] {
  const mode = process.env.DATABASE_SSL || "disable";
  if (process.env.VERCEL === "1" && mode !== "verify-full")
    throw new Error("En Vercel configura DATABASE_SSL=verify-full y TLS en PostgreSQL.");
  if (!["disable", "verify-full"].includes(mode))
    throw new Error("DATABASE_SSL debe ser disable o verify-full.");
  const url = new URL(connectionString);
  if (["sslmode", "sslcert", "sslkey", "sslrootcert"].some((key) => url.searchParams.has(key)))
    throw new Error("Configura TLS con DATABASE_SSL y DATABASE_SSL_CA; retira los parámetros SSL de DATABASE_URL.");
  return mode === "verify-full"
    ? { rejectUnauthorized: true, ...(process.env.DATABASE_SSL_CA
        ? { ca: process.env.DATABASE_SSL_CA.replaceAll("\\n", "\n") }
        : {}) }
    : false;
}

export function databasePoolConfig(connectionString: string): PoolConfig {
  const max = Number(process.env.DATABASE_POOL_MAX || (process.env.VERCEL === "1" ? 5 : 10));
  // Backups and authentication hold one connection while opening transactions.
  if (!Number.isInteger(max) || max < 3 || max > 50)
    throw new Error("DATABASE_POOL_MAX debe ser un entero entre 3 y 50.");
  return {
    connectionString,
    ssl: databaseSsl(connectionString),
    max,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: process.env.VERCEL === "1" ? 5000 : 30000,
  };
}
