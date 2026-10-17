import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { WorkspaceApp } from "../src/components/workspace-app";
import type { Workspace } from "../src/lib/types";
import { actor, createRepository } from "./helpers";
import { repository, backups } from "../src/server";
import { BackupManager } from "../src/server/backups";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("el proyecto renderiza snapshots anteriores sin los catálogos de tipos e impactos", () => {
  const legacy: Omit<Workspace, "taskTypes" | "impacts"> = {
    currentUser: {
      id: "admin",
      name: "Admin",
      email: "admin@example.com",
      image: null,
      role: "admin",
      createdAt: "2026-10-16",
      providers: [],
    },
    onboarding: { step: 2, firstProjectId: "project" },
    projects: [
      {
        id: "project",
        ownerId: "admin",
        name: "Proyecto anterior",
        description: "",
        icon: "🌱",
        color: "#059669",
        createdAt: "2026-10-16",
      },
    ],
    modules: [],
    features: [],
    statuses: [],
    tasks: [],
    priorities: [],
    labels: [],
  };
  const router = {
    back() {},
    forward() {},
    refresh() {},
    push() {},
    replace() {},
    prefetch() {},
    bfcacheId: "test",
  };
  const html = renderToStaticMarkup(
    createElement(
      AppRouterContext.Provider,
      { value: router },
      createElement(
        SearchParamsContext.Provider,
        { value: new URLSearchParams() },
        createElement(WorkspaceApp, {
          initialWorkspace: legacy as Workspace,
          projectId: "project",
        }),
      ),
    ),
  );
  assert.match(html, /Proyecto anterior/);
  assert.match(html, /Filtrar por tipos: Todos los tipos/);
  assert.match(html, /Filtrar por impactos: Todos los impactos/);
});

test("una instancia anterior a la recarga se renueva junto a sus respaldos y devuelve los catálogos", async () => {
  const directory = await mkdtemp(join(tmpdir(), "brote-cache-test-"));
  const path = join(directory, "workspace.sqlite");
  const previousPath = process.env.DATABASE_PATH;
  const oldRepo = await createRepository(path);
  let freshRepo: ReturnType<typeof repository> | undefined;
  let retired: Promise<void> | undefined;
  const close = oldRepo.close.bind(oldRepo);
  oldRepo.close = () => (retired ??= close());
  try {
    const projectId = (
      await oldRepo.execute(
        {
          type: "project.create",
          name: "Proyecto conservado",
          description: "",
          icon: "🌱",
          color: "#059669",
        },
        actor,
      )
    ).createdId!;
    const oldBackups = new BackupManager(oldRepo, path);
    Object.defineProperty(oldRepo, "cacheVersion", { value: undefined });
    Object.assign(globalThis, {
      broteRepository: oldRepo,
      broteBackups: oldBackups,
    });
    process.env.DATABASE_PATH = path;
    const freshBackups = backups();
    freshRepo = repository();
    assert.notEqual(freshRepo, oldRepo);
    assert.notEqual(freshBackups, oldBackups);
    assert.equal(repository(), freshRepo);
    assert.equal(backups(), freshBackups);
    const workspace = await freshRepo.getWorkspace(actor);
    assert.equal(workspace.projects[0].id, projectId);
    assert.equal(workspace.taskTypes.length, 4);
    assert.equal(workspace.impacts.length, 5);
    await retired;
    assert.equal(oldRepo.db.isOpen, false);
  } finally {
    Reflect.deleteProperty(globalThis, "broteRepository");
    Reflect.deleteProperty(globalThis, "broteBackups");
    if (previousPath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousPath;
    await freshRepo?.close();
    await oldRepo.close();
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 12,
      retryDelay: 50,
    });
  }
});
