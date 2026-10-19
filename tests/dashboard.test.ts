import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  assignedTo,
  canViewDashboard,
  dashboardDate,
  dashboardTasks,
  ledScopes,
  personalTasks,
  summarizeTasks,
} from "../src/lib/dashboard";
import { dashboardPath, safeReturnTo } from "../src/lib/routes";
import type { Task, Workspace } from "../src/lib/types";
import { Dashboard, ProjectsDirectory } from "../src/components/dashboard";
import {
  seedDashboardExamples,
  exampleReferenceDate,
} from "../src/server/dashboard-examples";
import { actor, addUser, createRepository } from "./helpers";

const now = new Date("2026-10-18T17:30:30Z");
function task(id: string, values: Partial<Task> = {}): Task {
  return {
    id,
    projectId: "p",
    featureId: "f",
    statusId: "open",
    title: id,
    description: "",
    priority: "normal",
    typeId: null,
    impactId: null,
    ticketIds: [],
    dueDate: null,
    dueTime: null,
    startDate: null,
    startTime: null,
    archived: false,
    position: 0,
    labels: [],
    clientIds: [],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    checklists: [],
    comments: [],
    statusHistory: [],
    leaderId: "admin",
    teamMemberIds: [],
    ...values,
  };
}
function workspace(): Workspace {
  return {
    currentUser: {
      id: "member",
      name: "Miembro",
      email: "member@example.com",
      image: null,
      role: "member",
      createdAt: now.toISOString(),
      providers: [],
    },
    onboarding: { step: 2, firstProjectId: "p" },
    projects: [
      {
        id: "p", clientIds: [], ticketIds: [],
        name: "Proyecto",
        description: "",
        icon: "P",
        color: "#059669",
        leaderId: "admin",
        createdAt: now.toISOString(),
        teamMemberIds: ["member"],
      },
    ],
    modules: [
      {
        id: "m", clientIds: [], ticketIds: [],
        projectId: "p",
        name: "Módulo",
        description: "",
        position: 0,
        leaderId: "member",
      },
    ],
    features: [
      {
        id: "f", clientIds: [], ticketIds: [],
        projectId: "p",
        moduleId: "m",
        name: "Feature",
        number: 1,
        description: "",
        pinned: false,
        position: 0,
        leaderId: "admin",
      },
      {
        id: "general", clientIds: [], ticketIds: [],
        projectId: "p",
        moduleId: null,
        name: "General",
        number: 1,
        description: "",
        pinned: false,
        position: 1,
        leaderId: "admin",
      },
    ],
    statuses: [
      {
        id: "open",
        projectId: "p",
        name: "Abierta personalizada",
        color: "#3b82f6",
        position: 0,
        isDone: false,
      },
      {
        id: "done",
        projectId: "p",
        name: "Entregada",
        color: "#059669",
        position: 1,
        isDone: true,
      },
    ],
    tasks: [],
    priorities: [],
    taskTypes: [],
    impacts: [],
    labels: [],
    clients: [],
    tickets: [],
    people: [],
  };
}

test("dashboard: avance por isDone, sin archivadas ni tareas duplicadas", () => {
  const w = workspace();
  const t = task("completed", { statusId: "done", dueDate: "2020-01-01" });
  w.tasks = [
    t,
    t,
    task("pending"),
    task("archived", { archived: true, statusId: "done" }),
  ];
  const metrics = summarizeTasks(w, w.tasks, now);
  assert.equal(metrics.total, 2);
  assert.equal(metrics.completed, 1);
  assert.equal(metrics.progress, 50);
  assert.equal(metrics.overdue.length, 0);
  assert.equal(summarizeTasks(w, [], now).progress, 0);
  assert.equal(dashboardTasks(w).length, 2);
});

test("dashboard: vencimientos respetan Bogotá, la hora y el día completo sin hora", () => {
  const w = workspace();
  const tasks = [
    task("yesterday", { dueDate: "2026-10-17" }),
    task("past-time", { dueDate: "2026-10-18", dueTime: "12:30" }),
    task("future-time", { dueDate: "2026-10-18", dueTime: "13:00" }),
    task("all-day", { dueDate: "2026-10-18" }),
    task("next-week", { dueDate: "2026-10-25" }),
    task("too-far", { dueDate: "2026-10-26" }),
    task("undated"),
    task("done", { statusId: "done", dueDate: "2026-10-10" }),
  ];
  const m = summarizeTasks(w, tasks, now);
  assert.deepEqual(
    m.overdue.map((t) => t.id),
    ["yesterday", "past-time"],
  );
  assert.deepEqual(
    m.today.map((t) => t.id),
    ["future-time", "all-day"],
  );
  assert.deepEqual(
    m.upcoming.map((t) => t.id),
    ["next-week"],
  );
  assert.equal(m.undated.length, 1);
  assert.equal(m.nextDue?.id, "future-time");
  assert.equal(m.agenda.at(-1)?.id, "undated");
  assert.equal(
    dashboardDate(new Date("2026-10-19T04:59:59Z")).day,
    "2026-10-18",
  );
  assert.equal(
    summarizeTasks(
      w,
      [task("end", { dueDate: "2026-10-18" })],
      new Date("2026-10-19T04:59:59Z"),
    ).overdue.length,
    0,
  );
  assert.equal(
    summarizeTasks(
      w,
      [task("end", { dueDate: "2026-10-18" })],
      new Date("2026-10-19T05:00:00Z"),
    ).overdue.length,
    1,
  );
});

test("dashboard: jerarquía, General y asignaciones personales se mantienen separados", () => {
  const w = workspace();
  w.tasks = [
    task("supervised"),
    task("mine", { leaderId: "member" }),
    task("shared", {
      featureId: "general",
      teamMemberIds: ["member", "member"],
    }),
    task("hidden-project", { projectId: "other" }),
  ];
  assert.deepEqual(
    personalTasks(w).map((t) => t.id),
    ["mine", "shared"],
  );
  assert.deepEqual(
    dashboardTasks(w, { kind: "module", projectId: "p", id: "m" }).map(
      (t) => t.id,
    ),
    ["supervised", "mine"],
  );
  assert.deepEqual(
    dashboardTasks(w, { kind: "module", projectId: "p", id: "general" }).map(
      (t) => t.id,
    ),
    ["shared"],
  );
  assert.equal(
    dashboardTasks(w, { kind: "feature", projectId: "p", id: "f" }).length,
    2,
  );
  assert.equal(assignedTo(w.tasks[2], "member"), true);
  assert.deepEqual(ledScopes(w), [{ kind: "module", projectId: "p", id: "m" }]);
  w.projects[0].leaderId = "member";
  assert.deepEqual(ledScopes(w), [
    { kind: "project", projectId: "p", id: "p" },
  ]);
});

test("dashboard: solo administradores y líderes del ámbito o superiores", () => {
  const w = workspace();
  const scope = { kind: "project" as const, projectId: "p", id: "p" };
  assert.equal(canViewDashboard(w, scope), false);
  assert.equal(
    canViewDashboard(w, { ...scope, kind: "module", id: "m" }),
    true,
  );
  assert.equal(
    canViewDashboard(w, { ...scope, kind: "feature", id: "f" }),
    true,
  );
  assert.equal(
    canViewDashboard(w, { ...scope, kind: "module", id: "general" }),
    false,
  );
  w.modules[0].leaderId = "admin";
  w.features[0].leaderId = "member";
  assert.equal(
    canViewDashboard(w, { ...scope, kind: "module", id: "m" }),
    false,
  );
  assert.equal(
    canViewDashboard(w, { ...scope, kind: "feature", id: "f" }),
    true,
  );
  w.features[0].leaderId = "admin";
  w.modules[0].teamMemberIds = ["member"];
  w.features[0].teamMemberIds = ["member"];
  assert.equal(
    canViewDashboard(w, { ...scope, kind: "feature", id: "f" }),
    false,
  );
  w.currentUser.role = "admin";
  assert.equal(canViewDashboard(w, scope), true);
  assert.equal(
    canViewDashboard(w, { ...scope, kind: "module", id: "general" }),
    true,
  );
  assert.equal(
    canViewDashboard(w, { ...scope, kind: "module", id: "missing" }),
    false,
  );
  assert.equal(
    canViewDashboard(w, {
      ...scope,
      kind: "feature",
      projectId: "other",
      id: "f",
    }),
    false,
  );
});

test("dashboard: retornos internos permitidos y rutas ajenas rechazadas", () => {
  for (const path of [
    "/dashboard",
    "/projects",
    dashboardPath("p"),
    dashboardPath("p", "module", "m"),
    dashboardPath("p", "feature", "f"),
  ])
    assert.equal(safeReturnTo("p", path), path);
  for (const path of [
    "/dashboard/evil",
    "/dashboard?returnTo=https://evil.test",
    dashboardPath("other"),
    "/projects/p/tasks/t/dashboard",
    "//evil.test",
    "/projects/p/modules/m/dashboard/evil",
  ])
    assert.equal(safeReturnTo("p", path), null);
  assert.equal(
    dashboardPath("p /", "feature", "f /"),
    "/projects/p%20%2F/features/f%20%2F/dashboard",
  );
});

test("dashboard: render de ambos perfiles, estados vacíos y directorio por permisos", () => {
  const w = workspace();
  w.tasks = [
    task("Trabajo personal", { leaderId: "member" }),
    task("Trabajo supervisado"),
  ];
  const props = {
    workspace: w,
    initialNow: now.toISOString(),
    refresh: async () => {},
    createProject: () => {},
  };
  const member = renderToStaticMarkup(createElement(Dashboard, props));
  assert.match(member, /Equipos que lidero/);
  assert.match(member, /Mi espacio/);
  assert.match(member, /Trabajo personal/);
  assert.doesNotMatch(member, /Carga del equipo/);
  assert.match(
    renderToStaticMarkup(createElement(ProjectsDirectory, props)),
    /disabled=""/,
  );
  w.currentUser.role = "admin";
  const admin = renderToStaticMarkup(createElement(Dashboard, props));
  assert.match(admin, /Carga del equipo/);
  assert.match(admin, /Proyectos con pendientes/);
  assert.match(admin, /Trabajo supervisado/);
  w.tasks = [task("Entrega completada", { statusId: "done" })];
  const feature = renderToStaticMarkup(createElement(Dashboard, { ...props, scope: { kind: "feature", projectId: "p", id: "f" } }));
  assert.match(feature, /Tareas de la feature/);
  assert.match(feature, /Entrega completada/);
  assert.match(feature, /Entregada/);
  w.tasks = [];
  w.projects = [];
  assert.match(
    renderToStaticMarkup(createElement(Dashboard, props)),
    /Todo empieza con una idea/,
  );
});

test("dashboard ejemplos: preview sin escrituras, dos proyectos, datos útiles y ejecución idempotente", async () => {
  const repo = await createRepository();
  try {
    const member = await addUser(repo, "dashboard-member");
    const preview = await seedDashboardExamples(repo, {
      apply: false,
      date: "2026-10-18",
    });
    assert.deepEqual(preview.added, {
      projects: 2,
      modules: 4,
      features: 10,
      tasks: 40,
      checklists: 40,
    });
    assert.equal((await repo.getWorkspace(actor)).projects.length, 0);
    const applied = await seedDashboardExamples(repo, {
      apply: true,
      date: "2026-10-18",
    });
    assert.deepEqual(applied.added, preview.added);
    const w = await repo.getWorkspace(actor);
    assert.equal(w.projects.length, 2);
    assert.equal(w.features.length, 10);
    assert.equal(w.tasks.length, 40);
    for (const p of w.projects) {
      const tasks = dashboardTasks(w, {
        kind: "project",
        projectId: p.id,
        id: p.id,
      });
      const metrics = summarizeTasks(w, tasks, now);
      assert.equal(metrics.total, 18);
      assert.equal(metrics.completed, p.leaderId === member.id ? 12 : 6);
      assert.ok(metrics.overdue.length);
      assert.ok(tasks.some((t) => t.leaderId === actor.id));
      assert.ok(tasks.some((t) => t.leaderId === member.id));
      assert.ok(tasks.some((t) => t.teamMemberIds?.length));
    }
    const personal = await repo.getWorkspace(member);
    assert.ok(personalTasks(personal).length);
    assert.ok(
      summarizeTasks(personal, personalTasks(personal), now).overdue.length,
    );
    assert.equal(ledScopes(personal).length, 2);
    assert.ok(personal.tasks.length < w.tasks.length);
    const repeat = await seedDashboardExamples(repo, {
      apply: true,
      date: "2026-10-19",
    });
    assert.deepEqual(repeat.added, {
      projects: 0,
      modules: 0,
      features: 0,
      tasks: 0,
      checklists: 0,
    });
    assert.deepEqual(repeat.skipped, {
      projects: 2,
      modules: 4,
      features: 10,
      tasks: 40,
    });
    assert.deepEqual((await repo.getWorkspace(actor)).tasks, w.tasks);
  } finally {
    await repo.close();
  }
});

test("dashboard ejemplos: un fallo revierte toda la transacción", async () => {
  const repo = await createRepository();
  try {
    await addUser(repo, "member");
    const execute = repo.execute.bind(repo);
    repo.execute = async (command, currentActor) => {
      if (command.type === "task.create") throw new Error("fallo simulado");
      return execute(command, currentActor);
    };
    await assert.rejects(
      seedDashboardExamples(repo, { apply: true }),
      /fallo simulado/,
    );
    const w = await repo.getWorkspace(actor);
    assert.equal(w.projects.length, 0);
    assert.equal(w.tasks.length, 0);
  } finally {
    await repo.close();
  }
});

test("dashboard ejemplos: fecha inválida y selección de cuentas ambigua se rechazan", async () => {
  assert.throws(() => exampleReferenceDate("2026-02-30"), /fecha/);
  const repo = await createRepository();
  try {
    await assert.rejects(
      seedDashboardExamples(repo, { apply: false }),
      /exactamente un usuario/,
    );
    await addUser(repo, "member-a");
    await addUser(repo, "member-b");
    await assert.rejects(
      seedDashboardExamples(repo, { apply: true }),
      /exactamente un usuario/,
    );
    assert.equal((await repo.getWorkspace(actor)).projects.length, 0);
  } finally {
    await repo.close();
  }
});
