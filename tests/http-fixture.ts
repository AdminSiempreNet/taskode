import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { serializeSignedCookie } from "better-call";
import { actor, authConfig, createRepository } from "./helpers";
import { session } from "../src/server/schema";
export async function startHttpFixture(external = false) {
  const directory = await mkdtemp(join(tmpdir(), "brote-http-")),
    path = join(directory, "workspace.sqlite");
  const repo = await createRepository(path),
    token = randomUUID(),
    now = new Date();
  await repo.store.db
    .insert(session)
    .values({
      id: randomUUID(),
      userId: actor.id,
      token,
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(Date.now() + 86400000),
    });
  const cookie = (
    await serializeSignedCookie(
      "better-auth.session_token",
      token,
      authConfig.BETTER_AUTH_SECRET,
      { path: "/" },
    )
  ).split(";")[0];
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  const base = `http://${external ? "host.docker.internal" : "127.0.0.1"}:${port}`;
  const server = spawn(
    process.execPath,
    [
      resolve("node_modules/next/dist/bin/next"),
      "start",
      "--hostname",
      external ? "0.0.0.0" : "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      env: {
        ...process.env,
        ...authConfig,
        BETTER_AUTH_URL: base,
        DATABASE_PATH: path,
        RESEND_API_KEY: "",
        RESEND_FROM_EMAIL: "",
        NODE_ENV: "production",
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  let logs = "";
  server.stdout.on("data", (data) => {
    logs += String(data);
  });
  server.stderr.on("data", (data) => {
    logs += String(data);
  });
  async function stop() {
    if (server.exitCode === null) {
      server.kill();
      await once(server, "exit");
    }
    await repo.close();
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 50,
    });
  }
  try {
    for (let n = 0; n < 150; n++) {
      if (server.exitCode !== null) throw new Error(logs);
      try {
        if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok)
          return { base, cookie, repo, stop, logs: () => logs };
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`No arrancó el servidor: ${logs}`);
  } catch (error) {
    await stop();
    throw error;
  }
}
