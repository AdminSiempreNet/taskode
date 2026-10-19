export type ProjectView = "board" | "list" | "calendar";
import type { EntityKind } from "./types";

export function getProjectView(value: string | null): ProjectView {
  return value === "list" || value === "calendar" ? value : "board";
}

function viewQuery(view: ProjectView): string {
  return view === "board" ? "" : `?view=${view}`;
}

export function projectPath(
  projectId: string,
  view: ProjectView = "board",
): string {
  return `/projects/${encodeURIComponent(projectId)}${viewQuery(view)}`;
}
export function taskPath(
  projectId: string,
  taskId: string,
  view: ProjectView = "board",
): string {
  return `${projectPath(projectId)}/tasks/${encodeURIComponent(taskId)}${viewQuery(view)}`;
}

export function dashboardPath(
  projectId: string,
  kind: "project" | "module" | "feature" = "project",
  id = projectId,
) {
  const root = `/projects/${encodeURIComponent(projectId)}`;
  return kind === "project"
    ? `${root}/dashboard`
    : `${root}/${kind === "module" ? "modules" : "features"}/${encodeURIComponent(id)}/dashboard`;
}

export function entityPath(
  projectId: string,
  kind: EntityKind,
  id: string,
  view: ProjectView = "board",
  tab?: string,
  returnTo?: string,
) {
  const root = `/projects/${encodeURIComponent(projectId)}`;
  const path =
    kind === "project"
      ? `${root}/details`
      : `${root}/${kind === "module" ? "modules" : kind === "feature" ? "features" : "tasks"}/${encodeURIComponent(id)}`;
  const query = new URLSearchParams();
  if (view !== "board") query.set("view", view);
  if (tab) query.set("tab", tab);
  if (returnTo) query.set("returnTo", returnTo);
  return `${path}${query.size ? `?${query}` : ""}`;
}

export function safeReturnTo(
  projectId: string,
  value: string | null,
): string | null {
  if (
    !value ||
    value.length > 4000 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\")
  )
    return null;
  try {
    const url = new URL(value, "http://taskode.invalid");
    const root = `/projects/${encodeURIComponent(projectId)}`;
    const rest = url.pathname.slice(root.length);
    if (
      url.origin === "http://taskode.invalid" &&
      (url.pathname === "/dashboard" || url.pathname === "/projects") &&
      !url.search
    )
      return url.pathname;
    if (
      url.origin !== "http://taskode.invalid" ||
      !url.pathname.startsWith(root) ||
      !/^(?:|\/details|\/dashboard|\/(?:modules|features)\/[^/]+(?:\/dashboard)?|\/tasks\/[^/]+)$/.test(
        rest,
      )
    )
      return null;
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}
