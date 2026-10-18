import type { Workspace } from "./types";
import { MINE_FILTER, UNASSIGNED_FILTER } from "./task-filters";

export type TaskFilterOption = {
  id: string;
  name: string;
  group: string;
  secondary?: string;
  image?: string | null;
  color?: string;
};
export type TaskFilterGroup = "status" | "label" | "priority" | "type" | "impact";

export const filterGroupValues = (ids: string[], group: TaskFilterGroup) =>
  ids.filter((id) => id.startsWith(`${group}:`)).map((id) => id.slice(group.length + 1));

export const groupedFilterIds = (ids: string[], group: TaskFilterGroup) =>
  ids.map((id) => `${group}:${id}`);

type Catalogs = Pick<Workspace, "statuses" | "labels" | "priorities" | "taskTypes" | "impacts" | "people">;

export function taskFilterOptions(workspace: Catalogs | null, projectId: string) {
  const userOptions: TaskFilterOption[] = [
    { id: MINE_FILTER, name: "Mías", secondary: "Soy líder o miembro del equipo", group: "Acceso rápido" },
    ...(workspace?.people ?? []).filter((person) => person.projectId === projectId)
      .sort((a, b) => a.name.localeCompare(b.name, "es"))
      .map((person) => ({
        id: person.id, name: person.name, secondary: person.email, image: person.image, group: "Usuarios",
      })),
  ];
  const stateOptions: TaskFilterOption[] = [
    ...(workspace?.statuses ?? []).filter((option) => option.projectId === projectId)
      .sort((a, b) => a.position - b.position)
      .map((option) => ({ ...option, id: `status:${option.id}`, group: "Estados" })),
    { id: `label:${UNASSIGNED_FILTER}`, name: "Sin etiqueta", group: "Etiquetas" },
    ...(workspace?.labels ?? []).filter((option) => option.projectId === projectId)
      .sort((a, b) => a.name.localeCompare(b.name, "es"))
      .map((option) => ({ ...option, id: `label:${option.id}`, group: "Etiquetas" })),
  ];
  const classificationOptions: TaskFilterOption[] = [
    ...(workspace?.priorities ?? []).filter((option) => option.projectId === projectId)
      .sort((a, b) => a.position - b.position)
      .map((option) => ({ ...option, id: `priority:${option.id}`, group: "Prioridad" })),
    { id: `type:${UNASSIGNED_FILTER}`, name: "Sin tipo", group: "Tipo" },
    ...(workspace?.taskTypes ?? []).filter((option) => option.projectId === projectId)
      .sort((a, b) => a.position - b.position)
      .map((option) => ({ ...option, id: `type:${option.id}`, group: "Tipo" })),
    { id: `impact:${UNASSIGNED_FILTER}`, name: "Sin impacto", group: "Impacto" },
    ...(workspace?.impacts ?? []).filter((option) => option.projectId === projectId)
      .sort((a, b) => a.position - b.position)
      .map((option) => ({ ...option, id: `impact:${option.id}`, group: "Impacto" })),
  ];
  return { userOptions, stateOptions, classificationOptions };
}
