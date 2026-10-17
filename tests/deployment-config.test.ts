import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { databasePoolConfig } from "../src/server/database-config";

test("Vercel: dev y otras ramas no despliegan; solo main está habilitada", () => {
  const config = JSON.parse(readFileSync("vercel.json", "utf8"));
  assert.deepEqual(config.git.deploymentEnabled, { "*": false, dev: false, main: true });
  assert.equal(config.buildCommand, "npm run build:vercel");
});

test("Vercel: la configuración de producción se valida sin conectarse y rechaza dev/Preview", () => {
  const env = {
    ...process.env, VERCEL: "1", VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main",
    DATABASE_URL: "postgresql://brote:example@db.example.com:5432/brote", DATABASE_SSL: "verify-full",
    DATABASE_POOL_MAX: "5", BETTER_AUTH_URL: "https://tareas.siempre.net.co", BETTER_AUTH_SECRET: "x".repeat(32),
    GOOGLE_CLIENT_ID: "test", GOOGLE_CLIENT_SECRET: "test", BACKUP_STORAGE: "s3",
    S3_ENDPOINT: "https://example.r2.cloudflarestorage.com", S3_REGION: "auto", S3_BUCKET: "private",
    S3_ACCESS_KEY_ID: "example", S3_SECRET_ACCESS_KEY: "example", S3_PREFIX: "tareas/test/",
  };
  const check = (overrides: Record<string, string> = {}) => spawnSync(process.execPath, ["--import", "tsx", "scripts/check-production.ts"], { env: { ...env, ...overrides }, encoding: "utf8", windowsHide: true });
  const valid = check();
  assert.equal(valid.status, 0, valid.stderr);
  const dev = check({ VERCEL_GIT_COMMIT_REF: "dev" });
  assert.equal(dev.status, 1);
  assert.match(dev.stderr, /push a dev no despliegan/);
  assert.equal(check({ VERCEL_ENV: "preview" }).status, 1);
  assert.equal(check({ DATABASE_SSL: "disable" }).status, 1);
  assert.equal(check({ BACKUP_STORAGE: "filesystem" }).status, 1);
});

test("PostgreSQL: valida TLS, CA y tamaño del pool sin permitir que la URL reemplace TLS", () => {
  const previous = { ...process.env };
  try {
    process.env.VERCEL = "1";
    process.env.DATABASE_SSL = "disable";
    assert.throws(() => databasePoolConfig("postgresql://brote:example@db.example.com/brote"), /verify-full/);
    process.env.DATABASE_SSL = "verify-full";
    process.env.DATABASE_SSL_CA = "line1\\nline2";
    process.env.DATABASE_POOL_MAX = "5";
    const config = databasePoolConfig("postgresql://brote:example@db.example.com/brote");
    assert.deepEqual(config.ssl, { rejectUnauthorized: true, ca: "line1\nline2" });
    assert.equal(config.idleTimeoutMillis, 5000);
    assert.throws(() => databasePoolConfig("postgresql://brote:example@db.example.com/brote?sslmode=require"), /retira los parámetros SSL/);
    process.env.DATABASE_POOL_MAX = "1";
    assert.throws(() => databasePoolConfig("postgresql://brote:example@db.example.com/brote"), /entre 3 y 50/);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});
