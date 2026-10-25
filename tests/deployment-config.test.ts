import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { databasePoolConfig } from "../src/server/database-config";
import webpush from "web-push";

test("Despliegue: sin Vercel; la imagen valida, migra y arranca en ese orden", () => {
  assert.equal(existsSync("vercel.json"), false);
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(pkg.scripts["build:vercel"], undefined);
  assert.equal(pkg.dependencies["@vercel/functions"], undefined);
  const entrypoint = readFileSync("scripts/docker-entrypoint.sh", "utf8");
  const order = ["dist/check-production.cjs", "dist/migrate.cjs", "exec node server.js"].map((step) => entrypoint.indexOf(step));
  assert.ok(order.every((index, i) => index > (order[i - 1] ?? -1)), "El entrypoint debe validar, migrar y luego arrancar.");
});

test("Producción: la configuración se valida sin conectarse", () => {
  const vapid = webpush.generateVAPIDKeys();
  const env = {
    ...process.env,
    DATABASE_URL: "postgresql://taskode:example@db.example.com:5432/taskode", DATABASE_SSL: "verify-full",
    DATABASE_POOL_MAX: "5", BETTER_AUTH_URL: "https://taskode.siempre.net.co", BETTER_AUTH_SECRET: "x".repeat(32),
    GOOGLE_CLIENT_ID: "test", GOOGLE_CLIENT_SECRET: "test", BACKUP_STORAGE: "s3", ATTACHMENT_STORAGE: "s3",
    S3_ENDPOINT: "https://example.r2.cloudflarestorage.com", S3_REGION: "auto", S3_BUCKET: "private",
    S3_ACCESS_KEY_ID: "example", S3_SECRET_ACCESS_KEY: "example", S3_PREFIX: "tareas/test/",
    ABLY_API_KEY: "test.key:example", ABLY_CHANNEL_NAMESPACE: "taskode-production",
    RESEND_API_KEY: "re_test", RESEND_FROM_EMAIL: "Taskode <avisos@example.com>",
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey, VAPID_SUBJECT: "https://taskode.siempre.net.co", NOTIFICATION_WORKER_SECRET: "s".repeat(32),
    MCP_ENABLED: "true", MCP_ALLOWED_ORIGINS: "",
  };
  const check = (overrides: Record<string, string> = {}) => spawnSync(process.execPath, ["--import", "tsx", "scripts/check-production.ts"], { env: { ...env, ...overrides }, encoding: "utf8", windowsHide: true });
  const valid = check();
  assert.equal(valid.status, 0, valid.stderr);
  assert.equal(check({ DATABASE_URL: "postgresql://taskode:example@postgres:5432/taskode" }).status, 1);
  assert.equal(check({ DATABASE_SSL: "disable" }).status, 1);
  assert.equal(check({ BACKUP_STORAGE: "filesystem" }).status, 1);
  assert.equal(check({ ATTACHMENT_STORAGE: "filesystem" }).status, 1);
  assert.equal(check({ BETTER_AUTH_URL: "https://tareas.siempre.net.co" }).status, 1);
  assert.equal(check({ ABLY_API_KEY: "" }).status, 1);
  assert.equal(check({ ABLY_CHANNEL_NAMESPACE: "taskode-development" }).status, 1);
  assert.equal(check({ VAPID_PRIVATE_KEY: "" }).status, 1);
  assert.equal(check({ NOTIFICATION_WORKER_SECRET: "" }).status, 1);
  assert.equal(check({ RESEND_API_KEY: "" }).status, 1);
  assert.equal(check({ RESEND_FROM_EMAIL: "" }).status, 1);
  assert.equal(check({ MCP_ENABLED: "false", MCP_ALLOWED_ORIGINS: "https://inspector.example.com" }).status, 0);
  assert.equal(check({ MCP_ENABLED: "quizá" }).status, 1);
  assert.equal(check({ MCP_ALLOWED_ORIGINS: "http://localhost:6274" }).status, 1);
  assert.equal(check({ MCP_ALLOWED_ORIGINS: "https://example.com/ruta" }).status, 1);
});

test("PostgreSQL: valida TLS, CA y tamaño del pool sin permitir que la URL reemplace TLS", () => {
  const previous = { ...process.env };
  try {
    process.env.DATABASE_SSL = "insegura";
    assert.throws(() => databasePoolConfig("postgresql://taskode:example@db.example.com/taskode"), /disable o verify-full/);
    process.env.DATABASE_SSL = "verify-full";
    process.env.DATABASE_SSL_CA = "line1\\nline2";
    process.env.DATABASE_POOL_MAX = "5";
    const config = databasePoolConfig("postgresql://taskode:example@db.example.com/taskode");
    assert.deepEqual(config.ssl, { rejectUnauthorized: true, ca: "line1\nline2" });
    assert.equal(config.idleTimeoutMillis, 30000);
    assert.throws(() => databasePoolConfig("postgresql://taskode:example@db.example.com/taskode?sslmode=require"), /retira los parámetros SSL/);
    process.env.DATABASE_POOL_MAX = "1";
    assert.throws(() => databasePoolConfig("postgresql://taskode:example@db.example.com/taskode"), /entre 3 y 50/);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});
