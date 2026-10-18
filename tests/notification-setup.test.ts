import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseEnv } from "node:util";

test("configuración genera secretos sin imprimirlos, conserva claves y rechaza pares incompletos", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "taskode-notification-setup-"),
  );
  const script = resolve("scripts/setup-notifications.ts"),
    loader = pathToFileURL(resolve("node_modules/tsx/dist/loader.mjs")).href;
  const run = (...args: string[]) =>
    spawnSync(process.execPath, ["--import", loader, script, ...args], {
      cwd: directory,
      encoding: "utf8",
      windowsHide: true,
    });
  try {
    const original =
      "# Preserve me\nDATABASE_URL=postgresql://example.invalid/db\n";
    await writeFile(join(directory, ".env.local"), original);
    const first = run();
    assert.equal(first.status, 0, first.stderr);
    const source = await readFile(join(directory, ".env.local"), "utf8"),
      env = parseEnv(source);
    assert.ok(source.startsWith(original));
    assert.ok((env.NOTIFICATION_WORKER_SECRET?.length ?? 0) >= 32);
    for (const key of ["VAPID_PRIVATE_KEY", "NOTIFICATION_WORKER_SECRET"]) {
      const value = env[key];
      assert.ok(value);
      assert.ok(!first.stdout.includes(value));
    }
    assert.equal(run().status, 0);
    assert.equal(await readFile(join(directory, ".env.local"), "utf8"), source);
    assert.equal(run("--production").status, 0);
    const production = parseEnv(
      await readFile(join(directory, ".env.production.local"), "utf8"),
    );
    assert.notEqual(production.VAPID_PRIVATE_KEY, env.VAPID_PRIVATE_KEY);
    assert.equal(production.VAPID_SUBJECT, "https://tareas.siempre.net.co");
    const bad = "NEXT_PUBLIC_VAPID_PUBLIC_KEY=broken\n";
    await writeFile(join(directory, ".env.local"), bad);
    assert.equal(run().status, 1);
    assert.equal(await readFile(join(directory, ".env.local"), "utf8"), bad);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
