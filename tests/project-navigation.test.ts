import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PROJECT_SHORTCUT_LIMIT,
  lastProjectCookieName,
  rankProjects,
  readProjectPreferences,
  rememberProject,
  resolveDefaultProject,
  saveProjectPreferences,
  searchProjects,
} from "../src/lib/project-navigation";
import type { Project } from "../src/lib/types";

const projects: Project[] = Array.from({ length: 8 }, (_, index) => ({
  id: `project-${index}`,
  ownerId: "user-a",
  name: index === 0 ? "Administración" : `Proyecto ${index}`,
  description: "",
  icon: "📋",
  color: "#059669",
  createdAt: `2026-10-${String(index + 1).padStart(2, "0")}T12:00:00.000Z`,
}));

test("el selector prioriza favoritos y visitas recientes y limita los accesos a cinco", () => {
  const ranked = rankProjects(projects, {
    favorites: ["project-1", "deleted-project"],
    recent: ["deleted-project", "project-3", "project-2"],
  });
  assert.deepEqual(
    ranked.slice(0, PROJECT_SHORTCUT_LIMIT).map((p) => p.id),
    ["project-1", "project-3", "project-2", "project-7", "project-6"],
  );
  assert.equal(projects[0].id, "project-0", "no modifica el orden original");
});

test("la búsqueda encuentra proyectos fuera de los cinco accesos, sin distinguir tildes", () => {
  const ranked = rankProjects(projects, { favorites: [], recent: [] });
  assert.ok(
    !ranked.slice(0, PROJECT_SHORTCUT_LIMIT).some((p) => p.id === "project-0"),
  );
  assert.deepEqual(
    searchProjects(ranked, "  ADMINISTRACION  ").map((p) => p.id),
    ["project-0"],
  );
  assert.deepEqual(searchProjects(ranked, "inexistente"), []);
  assert.equal(searchProjects(ranked, "Proyecto").length, 7);
});

test("el proyecto explícito prevalece y la preferencia solo abre proyectos accesibles", () => {
  assert.equal(
    resolveDefaultProject(projects, undefined, "project-4")?.id,
    "project-4",
  );
  assert.equal(
    resolveDefaultProject(projects, "project-2", "project-4")?.id,
    "project-2",
  );
  assert.equal(
    resolveDefaultProject(projects, undefined, "deleted-or-private")?.id,
    projects[0].id,
  );
  assert.equal(
    resolveDefaultProject(projects, undefined, "%invalid")?.id,
    projects[0].id,
  );
  assert.equal(resolveDefaultProject([], undefined, "project-4"), undefined);
  const special = { ...projects[0], id: "proyecto especial/1" };
  assert.equal(
    resolveDefaultProject([special], undefined, encodeURIComponent(special.id))
      ?.id,
    special.id,
  );
});

test("favoritos y recientes persisten separados por usuario y toleran almacenamiento inválido", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map<string, string>();
  try {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    });
    const preferences = { favorites: ["project-1"], recent: ["project-3"] };
    saveProjectPreferences("user-a", preferences);
    assert.deepEqual(readProjectPreferences("user-a"), preferences);
    assert.deepEqual(readProjectPreferences("user-b"), {
      favorites: [],
      recent: [],
    });
    values.set(
      "taskode.projects.user-a",
      '{"favorites":["project-1",8,"project-1"],"recent":false}',
    );
    assert.deepEqual(readProjectPreferences("user-a"), {
      favorites: ["project-1"],
      recent: [],
    });
    values.set("taskode.projects.user-a", "invalid JSON");
    assert.deepEqual(readProjectPreferences("user-a"), {
      favorites: [],
      recent: [],
    });
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get: () => {
        throw new Error("Storage blocked");
      },
    });
    assert.doesNotThrow(() => saveProjectPreferences("user-a", preferences));
    assert.deepEqual(readProjectPreferences("user-a"), {
      favorites: [],
      recent: [],
    });
  } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});

test("el último proyecto usa una cookie persistente por usuario, independiente de la sesión", () => {
  const previousDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    "document",
  );
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const fakeDocument = { cookie: "" };
  try {
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: fakeDocument,
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { location: { protocol: "https:" } },
    });
    rememberProject("user-a", "project-4");
    assert.match(
      fakeDocument.cookie,
      /^taskode\.last-project\.user-a=project-4;/,
    );
    assert.match(fakeDocument.cookie, /Max-Age=31536000/);
    assert.match(fakeDocument.cookie, /SameSite=Lax; Secure$/);
    assert.notEqual(
      lastProjectCookieName("user-a"),
      lastProjectCookieName("user-b"),
    );
    assert.ok(!lastProjectCookieName("unsafe; user").includes(";"));
  } finally {
    if (previousDocument)
      Object.defineProperty(globalThis, "document", previousDocument);
    else Reflect.deleteProperty(globalThis, "document");
    if (previousWindow)
      Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
