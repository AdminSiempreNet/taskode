export type ProjectView = "board" | "list" | "calendar";

export function getProjectView(value: string | null): ProjectView {
  return value === "list" || value === "calendar" ? value : "board";
}

function viewQuery(view: ProjectView): string {
  return view === "board" ? "" : `?view=${view}`;
}

export function projectPath(projectId: string, view: ProjectView = "board"): string {
  return `/projects/${encodeURIComponent(projectId)}${viewQuery(view)}`;
}
export function taskPath(
  projectId: string,
  taskId: string,
  view: ProjectView = "board",
): string {
  return `${projectPath(projectId)}/tasks/${encodeURIComponent(taskId)}${viewQuery(view)}`;
}
