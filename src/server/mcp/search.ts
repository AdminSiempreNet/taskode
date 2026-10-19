import { normalizeClientText } from "../../lib/clients";
import { MINE_FILTER, UNASSIGNED_FILTER, matchesTaskFilters } from "../../lib/task-filters";
import type { Task, Workspace } from "../../lib/types";

export interface TaskSearch {
  projectId?: string;
  moduleId?: string;
  featureId?: string;
  query?: string;
  statusIds?: string[];
  done?: boolean;
  assignee?: string;
  priorityIds?: string[];
  typeIds?: string[];
  impactIds?: string[];
  labels?: string[];
  clientId?: string;
  ticketId?: string;
  dueFrom?: string;
  dueTo?: string;
  overdue?: boolean;
  archived?: boolean;
  sort?: "due" | "updated" | "position" | "created";
  limit?: number;
  offset?: number;
}
const today = (now: Date, timeZone = "America/Bogota") =>
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

// Same visibility as the board (the workspace is already filtered for the actor). Text search
// is accent-insensitive over title, description, ticket numbers and labels.
export function searchTasks(workspace: Workspace, filters: TaskSearch, userId: string, now = new Date()) {
  const statuses = new Map(workspace.statuses.map((status) => [status.id, status]));
  const features = new Map(workspace.features.map((feature) => [feature.id, feature]));
  const zones = new Map(workspace.projects.map((project) => [project.id, project.timeZone]));
  const tickets = new Map(workspace.tickets.map((ticket) => [ticket.id, ticket.number]));
  const query = filters.query ? normalizeClientText(filters.query) : "";
  const assignee =
    filters.assignee === "me"
      ? MINE_FILTER
      : filters.assignee === "unassigned"
        ? UNASSIGNED_FILTER
        : filters.assignee;
  const matches = workspace.tasks.filter((task) => {
    if (filters.projectId && task.projectId !== filters.projectId) return false;
    if (filters.featureId && task.featureId !== filters.featureId) return false;
    if (filters.moduleId && features.get(task.featureId)?.moduleId !== filters.moduleId) return false;
    if (task.archived !== (filters.archived ?? false)) return false;
    const done = statuses.get(task.statusId)?.isDone ?? false;
    if (filters.done !== undefined && done !== filters.done) return false;
    if (assignee === UNASSIGNED_FILTER && (task.leaderId || task.teamMemberIds?.length)) return false;
    if (
      !matchesTaskFilters(task, {
        statusIds: filters.statusIds ?? [],
        typeIds: filters.typeIds ?? [],
        impactIds: filters.impactIds ?? [],
        priorityIds: filters.priorityIds ?? [],
        labelNames: filters.labels ?? [],
        userIds: assignee && assignee !== UNASSIGNED_FILTER ? [assignee] : [],
        currentUserId: userId,
      })
    )
      return false;
    if (filters.clientId && !task.clientIds.includes(filters.clientId)) return false;
    if (filters.ticketId && !task.ticketIds.includes(filters.ticketId)) return false;
    if (filters.dueFrom && (!task.dueDate || task.dueDate < filters.dueFrom)) return false;
    if (filters.dueTo && (!task.dueDate || task.dueDate > filters.dueTo)) return false;
    if (filters.overdue !== undefined) {
      const late = !done && !!task.dueDate && task.dueDate < today(now, zones.get(task.projectId));
      if (late !== filters.overdue) return false;
    }
    if (query) {
      const numbers = task.ticketIds.map((id) => tickets.get(id) ?? "").join(" ");
      const text = normalizeClientText(`${task.title} ${task.description} ${numbers} ${task.labels.join(" ")}`);
      if (!query.split(" ").every((word) => text.includes(word))) return false;
    }
    return true;
  });
  const order: Record<NonNullable<TaskSearch["sort"]>, (a: Task, b: Task) => number> = {
    due: (a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || (a.dueTime ?? "").localeCompare(b.dueTime ?? ""),
    updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
    created: (a, b) => b.createdAt.localeCompare(a.createdAt),
    position: (a, b) =>
      (statuses.get(a.statusId)?.position ?? 0) - (statuses.get(b.statusId)?.position ?? 0) || a.position - b.position,
  };
  matches.sort(order[filters.sort ?? "due"]);
  const offset = Math.max(0, filters.offset ?? 0);
  const limit = Math.min(100, Math.max(1, filters.limit ?? 25));
  return { total: matches.length, offset, limit, tasks: matches.slice(offset, offset + limit) };
}
