import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { WorkspaceApp } from "../src/components/workspace-app";
import type { Workspace } from "../src/lib/types";
test("el proyecto renderiza snapshots anteriores sin los catálogos de tipos e impactos", () => {
  const legacy: Omit<Workspace, "taskTypes" | "impacts" | "clients"> = {
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
