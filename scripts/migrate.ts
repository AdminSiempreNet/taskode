import { loadEnvConfig } from "@next/env";
import { DatabaseStore } from "../src/server/database";
loadEnvConfig(process.cwd());
async function main() {
  const store = new DatabaseStore(
    process.env.DATABASE_PATH || "./data/brote.sqlite",
  );
  try {
    await store.ready;
    console.log("Migraciones de Brote aplicadas.");
  } finally {
    store.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
