type Expansion = { projectId: string; ids: string[] };
const memory = new Map<string, Expansion>();
const key = (userId: string) =>
  `taskode.sidebar-expansion.${encodeURIComponent(userId)}`;

export function readSidebarExpansion(
  userId: string,
  projectId: string,
  storage?: Pick<Storage, "getItem" | "setItem">,
): Set<string> {
  let value = memory.get(userId);
  try {
    const parsed = JSON.parse(storage?.getItem(key(userId)) ?? "null");
    if (
      parsed &&
      typeof parsed.projectId === "string" &&
      Array.isArray(parsed.ids)
    )
      value = {
        projectId: parsed.projectId,
        ids: parsed.ids.filter(
          (id: unknown): id is string => typeof id === "string",
        ),
      };
  } catch {
    /* Storage is optional. */
  }
  const ids = new Set(value?.projectId === projectId ? value.ids : []);
  saveSidebarExpansion(userId, projectId, ids, storage);
  return ids;
}

export function saveSidebarExpansion(
  userId: string,
  projectId: string,
  ids: Set<string>,
  storage?: Pick<Storage, "setItem">,
) {
  const value = { projectId, ids: [...ids] };
  memory.set(userId, value);
  try {
    storage?.setItem(key(userId), JSON.stringify(value));
  } catch {
    /* Keep in-memory navigation working. */
  }
}
