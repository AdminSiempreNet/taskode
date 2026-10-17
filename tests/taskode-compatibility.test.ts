import assert from "node:assert/strict";
import { test } from "node:test";
import { createHmac } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { actor, authConfig, createRepository } from "./helpers";
import { BackupManager } from "../src/server/backups";
import { RESTORE_CONFIRMATION } from "../src/lib/backups";
import { InvitationService } from "../src/server/invitations";
import { readPreference } from "../src/lib/preferences";

test("Taskode restaura los respaldos anteriores y conserva su clasificación y descarga", async () => {
  const repo = await createRepository();
  const directory = await mkdtemp(join(tmpdir(), "taskode-compatibility-"));
  const manager = new BackupManager(repo, directory);
  try {
    const project = await repo.execute(
      {
        type: "project.create",
        name: "Proyecto existente",
        description: "",
        icon: "💻",
        color: "#059669",
      },
      actor,
    );
    const snapshot = await repo.getWorkspace(actor);
    const current = await manager.create();
    const contents = JSON.parse(
      (await manager.download(current.id)).toString(),
    );
    assert.equal(contents.format, "taskode-backup");
    assert.match(current.id, /^taskode-.*\.taskode-backup\.json$/);
    contents.format = "brote-backup";
    const legacyId = current.id
      .replace(/^taskode-manual-/, "brote-before-restore-")
      .replace(/\.taskode-backup\./, ".brote-backup.");
    const legacyBytes = Buffer.from(JSON.stringify(contents));
    await writeFile(join(directory, legacyId), legacyBytes);
    assert.equal(
      (await manager.list()).find((file) => file.id === legacyId)?.kind,
      "before-restore",
    );
    assert.deepEqual(await manager.download(legacyId), legacyBytes);
    await repo.execute(
      { type: "project.delete", id: project.createdId! },
      actor,
    );
    await manager.restore({ backupId: legacyId }, RESTORE_CONFIRMATION, true);
    assert.deepEqual(await repo.getWorkspace(actor), snapshot);
    await manager.restore({ file: legacyBytes }, RESTORE_CONFIRMATION, false);
    assert.deepEqual(await repo.getWorkspace(actor), snapshot);
    const exported = await manager.create();
    assert.equal(
      JSON.parse((await manager.download(exported.id)).toString()).format,
      "taskode-backup",
    );
    await manager.delete(legacyId);
    await assert.rejects(manager.download(legacyId), /no existe/);
  } finally {
    await repo.close();
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 50,
    });
  }
});

test("Taskode admite enlaces de invitación anteriores y mantiene revocación y verificación de correo", async () => {
  const repo = await createRepository();
  try {
    const service = new InvitationService(
      repo,
      authConfig.BETTER_AUTH_SECRET,
      authConfig.BETTER_AUTH_URL,
      async () => {},
    );
    const created = await service.create(
      { email: "legacy@example.com" },
      actor,
    );
    const currentToken = new URL(created.invitation.url).pathname
      .split("/")
      .pop()!;
    const [id, expiresAt] = currentToken.split(".");
    const legacySignature = createHmac("sha256", authConfig.BETTER_AUTH_SECRET)
      .update(`brote-invitation:${id}:${expiresAt}`)
      .digest("base64url");
    const legacyToken = `${id}.${expiresAt}.${legacySignature}`;
    assert.notEqual(currentToken, legacyToken);
    assert.equal((await service.verify(currentToken)).id, id);
    assert.equal(
      (await service.verify(legacyToken, "legacy@example.com")).id,
      id,
    );
    await assert.rejects(service.verify(legacyToken, "different@example.com"), {
      status: 403,
    });
    await assert.rejects(service.verify(`${legacyToken}x`));
    await service.revoke(id, actor);
    await assert.rejects(service.verify(legacyToken), /revocada/);
    await assert.rejects(service.verify(currentToken), /revocada/);
  } finally {
    await repo.close();
  }
});

test("Taskode conserva filtros y preferencias de la barra lateral, prioriza valores nuevos y tolera almacenamiento bloqueado", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map([
    ["brote.sidebar-width", "280"],
    ["brote.sidebar-collapsed", "true"],
    ["brote.status-filter.project", '["pending"]'],
    ["taskode.sidebar-collapsed", "false"],
  ]);
  try {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    });
    assert.equal(readPreference("taskode.sidebar-width"), "280");
    assert.equal(values.get("taskode.sidebar-width"), "280");
    assert.equal(readPreference("taskode.sidebar-collapsed"), "false");
    assert.equal(
      readPreference("taskode.status-filter.project"),
      '["pending"]',
    );
    assert.equal(readPreference("taskode.priority-filter.project"), null);
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get: () => {
        throw new Error("blocked");
      },
    });
    assert.equal(readPreference("taskode.sidebar-width"), null);
  } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
