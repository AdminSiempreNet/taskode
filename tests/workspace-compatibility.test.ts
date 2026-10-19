import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { WorkspaceApp } from "../src/components/workspace-app";
import type { Workspace, Project } from "../src/lib/types";

function legacyWorkspace() {
  const legacy: Omit<Workspace, "taskTypes" | "impacts" | "applications" | "clients" | "tickets" | "projects"> & {
    projects: Omit<Project, "clientIds" | "ticketIds">[];
  } = {
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
        leaderId: "admin",
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
  return legacy as Workspace;
}

function renderWorkspace(initialWorkspace: Workspace, menuSection?: "tickets") {
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
          initialWorkspace,
          projectId: "project",
          menuSection,
        }),
      ),
    ),
  );
  return html;
}

test("el proyecto renderiza snapshots anteriores sin los catálogos de tipos e impactos", () => {
  const html = renderWorkspace(legacyWorkspace());
  assert.match(html, /Proyecto anterior/);
  assert.match(html, /aria-label="Usuarios"/);
  assert.match(html, /aria-label="Estados y etiquetas"/);
  assert.match(html, /aria-label="Clasificación"/);
  assert.equal((html.match(/role="combobox"/g) ?? []).length, 3);
});

test("Tickets renderiza un snapshot anterior sin tickets ni clientes antes de cargar la API", () => {
  const html = renderWorkspace(legacyWorkspace(), "tickets");
  assert.match(html, /id="tickets-title"/);
  assert.match(html, /Aún no hay tickets/);
  assert.match(html, /aria-label="Buscar tickets"/);
});

test("Tickets conserva los registros actuales aunque falte el catálogo de clientes", () => {
  const workspace = legacyWorkspace();
  workspace.tickets = [{ id: "ticket", number: "00042", description: "Ticket conservado", url: null, clientId: null, createdAt: "2026-10-18T12:00:00.000Z", updatedAt: "2026-10-18T12:00:00.000Z" }];
  const html = renderWorkspace(workspace, "tickets");
  assert.match(html, /00042/);
  assert.match(html, /Ticket conservado/);
  assert.match(html, /Sin cliente/);
  assert.equal("clients" in workspace, false);
});
