import { defineConfig } from "drizzle-kit";
import { loadEnvConfig } from "@next/env";
import { databaseUrl } from "./src/server/database";
import { databaseSsl } from "./src/server/database-config";
loadEnvConfig(process.cwd());
const connectionString = databaseUrl();
const url = new URL(connectionString);
export default defineConfig({
  schema: "./src/server/schema.ts",
  out: "./drizzle/postgresql",
  dialect: "postgresql",
  dbCredentials: {
    // Drizzle Kit's URL credentials discard a separate ssl option.
    host: url.hostname.replace(/^\[|\]$/g, ""),
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)),
    ssl: databaseSsl(connectionString),
  },
});
