import { formatFeatureNumber } from "./features";

type SidebarGroup = { id: string; name: string; description: string };
type SidebarFeature = {
  id: string;
  number: number;
  name: string;
  description: string;
  moduleId?: string | null;
};

export function normalizeSidebarText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es");
}

/** Applies the search and the "only with tasks" filter to the sidebar groups. */
export function sidebarVisibility<
  G extends SidebarGroup,
  F extends SidebarFeature,
>({
  groups,
  features,
  query,
  counts,
  onlyWithTasks,
  selectedId,
}: {
  groups: G[];
  features: F[];
  query: string;
  counts: Record<string, number>;
  onlyWithTasks: boolean;
  selectedId: string;
}) {
  const normalizedQuery = normalizeSidebarText(query.trim());
  const matchingGroupIds = new Set(
    groups
      .filter((group) =>
        normalizeSidebarText(`${group.name} ${group.description}`).includes(
          normalizedQuery,
        ),
      )
      .map((group) => group.id),
  );
  // The selected feature stays visible so a new or emptied feature does not vanish under the cursor.
  const matches = (feature: F) =>
    (!onlyWithTasks ||
      feature.id === selectedId ||
      (counts[feature.id] ?? 0) > 0) &&
    (matchingGroupIds.has(feature.moduleId ?? "general") ||
      normalizeSidebarText(
        `${formatFeatureNumber(feature.number)} ${feature.name} ${feature.description}`,
      ).includes(normalizedQuery));
  const shownGroups = groups.flatMap((group) => {
    const allItems = features.filter(
      (feature) => (feature.moduleId ?? "general") === group.id,
    );
    const items = allItems.filter(matches);
    const hidden =
      !items.length &&
      (onlyWithTasks ||
        (normalizedQuery !== "" && !matchingGroupIds.has(group.id)));
    return hidden
      ? []
      : [
          {
            ...group,
            items,
            total: onlyWithTasks ? items.length : allItems.length,
          },
        ];
  });
  return { searching: normalizedQuery !== "", matches, groups: shownGroups };
}

/** Adds or removes the given ids from a set of module ids. */
export function setSidebarGroups(
  current: Set<string>,
  ids: string[],
  include: boolean,
) {
  const next = new Set(current);
  for (const id of ids) {
    if (include) next.add(id);
    else next.delete(id);
  }
  return next;
}

const memory = new Map<string, boolean>();
const key = (userId: string) =>
  `taskode.sidebar-tasks-only.${encodeURIComponent(userId)}`;

export function readSidebarTasksOnly(
  userId: string,
  storage?: Pick<Storage, "getItem">,
) {
  try {
    const value = storage?.getItem(key(userId));
    if (value === "true" || value === "false") return value === "true";
  } catch {
    /* Storage is optional. */
  }
  return memory.get(userId) ?? false;
}

export function saveSidebarTasksOnly(
  userId: string,
  value: boolean,
  storage?: Pick<Storage, "setItem">,
) {
  memory.set(userId, value);
  try {
    storage?.setItem(key(userId), String(value));
  } catch {
    /* Keep the in-memory preference working. */
  }
}
