import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

export const migrationsFolder = () =>
  resolve(process.cwd(), "drizzle/postgresql");
export function expectedMigration() {
  const folder = migrationsFolder();
  const journalPath = join(folder, "meta/_journal.json");
  const journal = JSON.parse(
    readFileSync(/* turbopackIgnore: true */ journalPath, "utf8"),
  ) as {
    entries: { tag: string; when: number }[];
  };
  const entry = journal.entries.at(-1);
  if (!entry) throw new Error("No hay migraciones PostgreSQL empaquetadas.");
  const path = join(folder, `${entry.tag}.sql`);
  return {
    ...entry,
    hash: createHash("sha256")
      .update(readFileSync(/* turbopackIgnore: true */ path))
      .digest("hex"),
  };
}
