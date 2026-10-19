import { createReadStream, createWriteStream, existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rename, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { resolve, join } from "node:path";
import { parseEnv } from "node:util";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";

// Read production explicitly: never fall back to a developer's .env.local.
const filename = resolve(".env.production.local");
const env = {
  ...(existsSync(filename) ? parseEnv(readFileSync(filename, "utf8")) : {}),
  ...process.env,
};
const image = "pgvector/pgvector:0.8.7-pg18-bookworm";

async function main() {
  const url = new URL(env.DATABASE_URL || "");
  if (!["postgres:", "postgresql:"].includes(url.protocol) ||
      ["localhost", "127.0.0.1", "::1", "[::1]", "postgres"].includes(url.hostname))
    throw Error("DATABASE_URL debe apuntar al PostgreSQL externo de producción.");
  if (env.DATABASE_SSL !== "verify-full" ||
      ["sslmode", "sslcert", "sslkey", "sslrootcert"].some(key => url.searchParams.has(key)))
    throw Error("Configura DATABASE_SSL=verify-full y la CA por separado de DATABASE_URL.");
  const schema = env.DATABASE_SCHEMA || "public";
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw Error("DATABASE_SCHEMA no es válido.");

  const directory = resolve("data/backups");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replaceAll(":", "-");
  const name = `production-${stamp}-${randomUUID().slice(0, 8)}`;
  const destination = join(directory, `${name}.dump`);
  const partial = `${destination}.partial`;
  const temporary = await mkdtemp(join(directory, ".pgdump-"));
  const caPath = join(temporary, "ca.crt");
  const args = ["run", "--rm"];
  const pgEnv = {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGSSLMODE: "verify-full",
    PGCONNECT_TIMEOUT: "15",
    PGAPPNAME: "taskode-production-backup",
  };
  for (const key of ["PGHOST", "PGPORT", "PGUSER", "PGPASSWORD", "PGDATABASE", "PGSSLMODE", "PGCONNECT_TIMEOUT", "PGAPPNAME"])
    args.push("--env", key);
  let complete = false;
  try {
    if (env.DATABASE_SSL_CA) {
      await writeFile(caPath, env.DATABASE_SSL_CA.replaceAll("\\n", "\n"), { mode: 0o600 });
      args.push("--mount", `type=bind,source=${caPath},target=/tls/ca.crt,readonly`, "--env", "PGSSLROOTCERT");
      pgEnv.PGSSLROOTCERT = "/tls/ca.crt";
    }
    args.push(image, "pg_dump", "--format=custom", "--no-owner", "--no-acl", `--schema=${schema}`, "--lock-wait-timeout=15s");
    const child = spawn("docker", args, { env: pgEnv, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", chunk => { stderr = (stderr + chunk).slice(-16_000); });
    const finished = new Promise((accept, reject) => {
      child.once("error", reject);
      child.once("close", code => code === 0 ? accept() : reject(Error(`pg_dump falló (${code}). ${stderr}`)));
    });
    await Promise.all([pipeline(child.stdout, createWriteStream(partial, { flags: "wx", mode: 0o600 })), finished]);
    if ((await stat(partial)).size < 100) throw Error("El respaldo está vacío.");
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(partial)) hash.update(chunk);
    await rename(partial, destination);
    await writeFile(`${destination}.json`, JSON.stringify({
      createdAt: new Date().toISOString(), host: url.hostname, database: pgEnv.PGDATABASE,
      schema, image, sha256: hash.digest("hex"), bytes: (await stat(destination)).size,
    }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    complete = true;
    console.log(`Respaldo PostgreSQL creado: ${destination}`);
    console.log("Conserva el .dump y su manifiesto fuera del repositorio; comprueba una restauración antes de migrar.");
  } finally {
    await unlink(caPath).catch(error => { if (error.code !== "ENOENT") throw error; });
    await rmdir(temporary);
    if (!complete) await unlink(partial).catch(error => { if (error.code !== "ENOENT") throw error; });
  }
}

main().catch(error => {
  // Never print connection URLs, passwords or environment values.
  let message = error instanceof Error ? error.message : "No se pudo crear el respaldo.";
  for (const key of ["DATABASE_URL", "DATABASE_SSL_CA"])
    if (env[key]) message = message.replaceAll(env[key], "[oculto]");
  try {
    const password = decodeURIComponent(new URL(env.DATABASE_URL).password);
    if (password) message = message.replaceAll(password, "[oculto]");
  } catch {}
  console.error(message);
  process.exitCode = 1;
});
