import { defineConfig } from "drizzle-kit";
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
export default defineConfig({
  schema: "./src/server/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: { url: process.env.DATABASE_PATH || "./data/brote.sqlite" },
});
