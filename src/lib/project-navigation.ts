import { readPreference } from "./preferences";
import type { Project } from "./types";

export const PROJECT_SHORTCUT_LIMIT = 5;
export interface ProjectPreferences {
  favorites: string[];
  recent: string[];
}

function preferenceKey(userId: string) {
  return `taskode.projects.${encodeURIComponent(userId)}`;
}

export function lastProjectCookieName(userId: string) {
  return `taskode.last-project.${encodeURIComponent(userId)}`;
}

export function readProjectPreferences(userId: string): ProjectPreferences {
  try {
    const value = JSON.parse(readPreference(preferenceKey(userId)) ?? "null");
    const ids = (items: unknown): string[] =>
      Array.isArray(items)
        ? [
            ...new Set(
              items.filter((id): id is string => typeof id === "string"),
            ),
          ]
        : [];
    return { favorites: ids(value?.favorites), recent: ids(value?.recent) };
  } catch {
    return { favorites: [], recent: [] };
  }
}

export function saveProjectPreferences(
  userId: string,
  value: ProjectPreferences,
) {
  try {
    localStorage.setItem(preferenceKey(userId), JSON.stringify(value));
  } catch {
    // Navigation remains available when browser storage is disabled.
  }
}

export function rememberProject(userId: string, projectId: string) {
  try {
    document.cookie = `${lastProjectCookieName(userId)}=${encodeURIComponent(projectId)}; Path=/; Max-Age=31536000; SameSite=Lax${window.location.protocol === "https:" ? "; Secure" : ""}`;
  } catch {
    // A blocked cookie must not prevent opening a project.
  }
}

export function resolveDefaultProject(
  projects: Project[],
  requestedId: unknown,
  savedId: string | undefined,
) {
  let rememberedId: string | undefined;
  try {
    rememberedId = savedId ? decodeURIComponent(savedId) : undefined;
  } catch {
    // Ignore a malformed preference and use an accessible project.
  }
  return (
    projects.find((project) => project.id === requestedId) ??
    projects.find((project) => project.id === rememberedId) ??
    projects[0]
  );
}

export function rankProjects(
  projects: Project[],
  preferences: ProjectPreferences,
) {
  const favorites = new Set(preferences.favorites);
  const recent = new Map(preferences.recent.map((id, index) => [id, index]));
  return [...projects].sort((a, b) => {
    const favoriteOrder =
      Number(favorites.has(b.id)) - Number(favorites.has(a.id));
    if (favoriteOrder) return favoriteOrder;
    const aRecent = recent.get(a.id) ?? Infinity;
    const bRecent = recent.get(b.id) ?? Infinity;
    if (aRecent !== bRecent) return aRecent - bRecent;
    return (
      b.createdAt.localeCompare(a.createdAt) ||
      a.name.localeCompare(b.name, "es")
    );
  });
}

export function searchProjects(projects: Project[], query: string) {
  const normalize = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("es");
  const search = normalize(query.trim());
  return projects.filter((project) => normalize(project.name).includes(search));
}
