import type { Task } from "./types";

export const UNASSIGNED_FILTER = "__unassigned__";
export const MINE_FILTER = "__mine__";

export function validFilterIds(
  ids: string[],
  options: { id: string }[],
  optional = false,
) {
  const available = new Set(options.map((option) => option.id));
  if (optional) available.add(UNASSIGNED_FILTER);
  return [...new Set(ids)].filter((id) => available.has(id));
}

export function matchesTaskFilters(
  task: Pick<
    Task,
    "statusId" | "typeId" | "impactId" | "leaderId" | "teamMemberIds"
  > & Partial<Pick<Task, "priority" | "labels" | "applicationIds">>,
  filters: {
    statusIds: string[];
    typeIds: string[];
    impactIds: string[];
    applicationIds?: string[];
    userIds?: string[];
    currentUserId?: string;
    priorityIds?: string[];
    labelNames?: string[];
    includeUnlabeled?: boolean;
  },
) {
  return (
    (!filters.userIds?.length ||
      filters.userIds.some((value) => {
        const id = value === MINE_FILTER ? filters.currentUserId : value;
        return (
          !!id && (task.leaderId === id || task.teamMemberIds?.includes(id))
        );
      })) &&
    (!filters.statusIds.length || filters.statusIds.includes(task.statusId)) &&
    (!filters.typeIds.length ||
      filters.typeIds.includes(task.typeId ?? UNASSIGNED_FILTER)) &&
    (!filters.impactIds.length ||
      filters.impactIds.includes(task.impactId ?? UNASSIGNED_FILTER)) &&
    (!filters.applicationIds?.length ||
      filters.applicationIds.some(id => id === UNASSIGNED_FILTER ? !task.applicationIds?.length : task.applicationIds?.includes(id))) &&
    (!filters.priorityIds?.length ||
      (!!task.priority && filters.priorityIds.includes(task.priority))) &&
    ((!filters.labelNames?.length && !filters.includeUnlabeled) ||
      filters.labelNames?.some((label) => task.labels?.includes(label)) ||
      (!!filters.includeUnlabeled && !task.labels?.length))
  );
}
