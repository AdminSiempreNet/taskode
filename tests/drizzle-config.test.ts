import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

function credentials(overrides: Record<string, string>) {
  const result = spawnSync(
    process.execPath,
    [
      "--import", "tsx", "--eval",
      'console.log(JSON.stringify(require("./drizzle.config.ts").default.dbCredentials))',
    ],
    {
      env: {
        ...process.env,
        NODE_ENV: "test",
        VERCEL: "",
        DATABASE_URL: "postgresql://taskode:example@127.0.0.1/taskode",
        DATABASE_SSL: "disable",
        DATABASE_SSL_CA: "",
        ...overrides,
      },
      encoding: "utf8",
      windowsHide: true,
    },
  );
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("Drizzle Kit recibe TLS y CA mediante credenciales que conservan ssl", () => {
  const config = credentials({
    DATABASE_URL: "postgresql://task%40ode:p%40ss%3Aword%2F%25@db.example.com:5440/task%20ode",
    DATABASE_SSL: "verify-full",
    DATABASE_SSL_CA: "line1\\nline2",
  });
  // The URL credentials variant strips ssl during Drizzle Kit validation.
  assert.equal("url" in config, false);
  assert.deepEqual(config, {
    host: "db.example.com",
    port: 5440,
    user: "task@ode",
    password: "p@ss:word/%",
    database: "task ode",
    ssl: { rejectUnauthorized: true, ca: "line1\nline2" },
  });
});

test("Drizzle Kit conserva las conexiones locales sin TLS y admite IPv6", () => {
  const config = credentials({
    DATABASE_URL: "postgresql://taskode:example@[::1]/taskode",
  });
  assert.equal(config.host, "::1");
  assert.equal(config.port, 5432);
  assert.equal(config.ssl, false);
});
