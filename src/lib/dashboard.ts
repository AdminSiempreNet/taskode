import type { Project, Task, Workspace } from "./types";
import { projectClock, taskOverdue } from "./project-time";

export type DashboardScope = {
  kind: "project" | "module" | "feature";
  projectId: string;
  id: string;
};

export function canViewDashboard(workspace: Workspace, scope: DashboardScope) {
  const project = workspace.projects.find((p) => p.id === scope.projectId);
  if (!project) return false;
  const module =
    scope.kind === "module"
      ? workspace.modules.find(
          (m) => m.id === scope.id && m.projectId === project.id,
        )
      : undefined;
  const feature =
    scope.kind === "feature"
      ? workspace.features.find(
          (f) => f.id === scope.id && f.projectId === project.id,
        )
      : undefined;
  if (scope.kind === "project" && scope.id !== project.id) return false;
  if (scope.kind === "module" && scope.id !== "general" && !module)
    return false;
  if (scope.kind === "feature" && !feature) return false;
  const user = workspace.currentUser;
  return (
    user.role === "admin" ||
    project.leaderId === user.id ||
    module?.leaderId === user.id ||
    feature?.leaderId === user.id ||
    (!!feature?.moduleId &&
      workspace.modules.some(
        (m) =>
          m.id === feature.moduleId &&
          m.projectId === project.id &&
          m.leaderId === user.id,
      ))
  );
}

export function dashboardTasks(workspace: Workspace, scope?: DashboardScope) {
  const projects = new Set(workspace.projects.map((p) => p.id));
  const featureIds =
    scope?.kind === "module"
      ? new Set(
          workspace.features
            .filter(
              (f) =>
                f.projectId === scope.projectId &&
                f.moduleId === (scope.id === "general" ? null : scope.id),
            )
            .map((f) => f.id),
        )
      : undefined;
  return [
    ...new Map(
      workspace.tasks
        .filter(
          (t) =>
            !t.archived &&
            projects.has(t.projectId) &&
            (!scope ||
              (t.projectId === scope.projectId &&
                (scope.kind === "project" ||
                  (scope.kind === "feature"
                    ? t.featureId === scope.id
                    : featureIds?.has(t.featureId))))),
        )
        .map((t) => [t.id, t]),
    ).values(),
  ];
}

export function assignedTo(task: Task, userId: string) {
  return task.leaderId === userId || !!task.teamMemberIds?.includes(userId);
}

export function personalTasks(workspace: Workspace) {
  return dashboardTasks(workspace).filter((t) =>
    assignedTo(t, workspace.currentUser.id),
  );
}

export function ledScopes(workspace: Workspace): DashboardScope[] {
  const userId = workspace.currentUser.id;
  const projects = workspace.projects.filter((p) => p.leaderId === userId);
  const projectIds = new Set(projects.map((p) => p.id));
  const modules = workspace.modules.filter(
    (m) => m.leaderId === userId && !projectIds.has(m.projectId),
  );
  const moduleIds = new Set(modules.map((m) => m.id));
  return [
    ...projects.map((p): DashboardScope => ({
      kind: "project",
      projectId: p.id,
      id: p.id,
    })),
    ...modules.map((m): DashboardScope => ({
      kind: "module",
      projectId: m.projectId,
      id: m.id,
    })),
    ...workspace.features
      .filter(
        (f) =>
          f.leaderId === userId &&
          !projectIds.has(f.projectId) &&
          !moduleIds.has(f.moduleId ?? ""),
      )
      .map((f): DashboardScope => ({
        kind: "feature",
        projectId: f.projectId,
        id: f.id,
      })),
  ];
}

export const dashboardDate = projectClock;

export type DashboardMetrics = ReturnType<typeof summarizeTasks>;

export function summarizeTasks(workspace: Workspace, tasks: Task[], now: Date) {
  const active = [
    ...new Map(tasks.filter((t) => !t.archived).map((t) => [t.id, t])).values(),
  ];
  const doneIds = new Set(
    workspace.statuses
      .filter((s) => s.isDone)
      .map((s) => `${s.projectId}/${s.id}`),
  );
  const done = active.filter((t) =>
    doneIds.has(`${t.projectId}/${t.statusId}`),
  );
  const open = active.filter(
    (t) => !doneIds.has(`${t.projectId}/${t.statusId}`),
  );
  const zones = new Map(workspace.projects.map((p) => [p.id, p.timeZone]));
  const clocks = new Map(workspace.projects.map((p) => [p.id, projectClock(now, p.timeZone)]));
  const clockFor = (task: Task) => clocks.get(task.projectId) ?? projectClock(now);
  const endDayFor = (task: Task) => { const end = new Date(`${clockFor(task).day}T12:00:00Z`); end.setUTCDate(end.getUTCDate() + 7); return end.toISOString().slice(0, 10); };
  const overdue = open.filter(
    (t) =>
      t.dueDate &&
      taskOverdue(t, now, zones.get(t.projectId)),
  );
  const overdueIds = new Set(overdue.map((t) => t.id));
  const today = open.filter(
    (t) => t.dueDate === clockFor(t).day && !overdueIds.has(t.id),
  );
  const upcoming = open.filter(
    (t) => t.dueDate && t.dueDate > clockFor(t).day && t.dueDate <= endDayFor(t),
  );
  const undated = open.filter((t) => !t.dueDate);
  const byDue = (a: Task, b: Task) =>
    (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") ||
    (a.dueTime ?? "23:59").localeCompare(b.dueTime ?? "23:59") ||
    a.title.localeCompare(b.title, "es") ||
    a.id.localeCompare(b.id);
  return {
    total: active.length,
    completed: done.length,
    open: open.length,
    progress: active.length
      ? Math.round((done.length / active.length) * 100)
      : 0,
    overdue: overdue.sort(byDue),
    today: today.sort(byDue),
    upcoming: upcoming.sort(byDue),
    undated: undated.sort(byDue),
    agenda: open.sort(byDue),
    nextDue:
      open.filter((t) => !!t.dueDate && !overdueIds.has(t.id)).sort(byDue)[0] ??
      null,
  };
}

export function projectDashboardScope(project: Project): DashboardScope {
  return { kind: "project", projectId: project.id, id: project.id };
}
