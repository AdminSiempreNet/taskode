import { defineConfig } from "drizzle-kit";
import { loadEnvConfig } from "@next/env";
import { databaseUrl } from "./src/server/database";
import { databaseSsl } from "./src/server/database-config";
loadEnvConfig(process.cwd());
export default defineConfig({
  schema: "./src/server/schema.ts",
  out: "./drizzle/postgresql",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl(),
    ssl: databaseSsl(databaseUrl()),
  },
});
