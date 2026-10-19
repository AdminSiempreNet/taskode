import { loadEnvConfig } from "@next/env";
import { databaseUrl } from "../src/server/database";
import { PostgresRepository } from "../src/server/postgres";
import { seedDashboardExamples } from "../src/server/dashboard-examples";

async function main() {
  const args = process.argv.slice(2);
  if (
    args.some(
      (arg) => arg !== "--apply" && !/^--date=\d{4}-\d{2}-\d{2}$/.test(arg),
    )
  )
    throw new Error(
      "Uso: npm run db:seed:dashboard -- [--apply] [--date=AAAA-MM-DD]",
    );
  loadEnvConfig(process.cwd(), true);
  if (
    !["localhost", "127.0.0.1", "::1", "[::1]"].includes(
      new URL(databaseUrl()).hostname,
    )
  )
    throw new Error(
      "La carga de ejemplos requiere la base PostgreSQL local del proyecto.",
    );
  const repo = new PostgresRepository(databaseUrl());
  try {
    console.log(
      JSON.stringify(
        await seedDashboardExamples(repo, {
          apply: args.includes("--apply"),
          date: args.find((arg) => arg.startsWith("--date="))?.slice(7),
        }),
        null,
        2,
      ),
    );
  } finally {
    await repo.close();
  }
}
main().catch((error) => {
  console.error(
    error instanceof Error
      ? error.message
      : "No se pudieron cargar los ejemplos.",
  );
  process.exitCode = 1;
});
