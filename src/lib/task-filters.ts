import type { Task } from "./types";

export const UNASSIGNED_FILTER = "__unassigned__";

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
  task: Pick<Task, "statusId" | "typeId" | "impactId">,
  filters: { statusIds: string[]; typeIds: string[]; impactIds: string[] },
) {
  return (
    (!filters.statusIds.length || filters.statusIds.includes(task.statusId)) &&
    (!filters.typeIds.length ||
      filters.typeIds.includes(task.typeId ?? UNASSIGNED_FILTER)) &&
    (!filters.impactIds.length ||
      filters.impactIds.includes(task.impactId ?? UNASSIGNED_FILTER))
  );
}
