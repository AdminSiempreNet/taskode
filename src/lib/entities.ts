import type { EntityKind, EntityRef } from "./types";

export const entityNames: Record<EntityKind, string> = {
  project: "proyecto",
  module: "módulo",
  feature: "feature",
  task: "tarea",
};

export function entityColumns(scope: EntityRef) {
  return {
    projectId: scope.projectId,
    scopeType: scope.kind,
    taskId: scope.kind === "task" ? scope.id : null,
    moduleId: scope.kind === "module" ? scope.id : null,
    featureId: scope.kind === "feature" ? scope.id : null,
  };
}

export function rowScope(row: {
  projectId: unknown;
  scopeType: unknown;
  taskId: unknown;
  moduleId: unknown;
  featureId: unknown;
}): EntityRef | null {
  const kind = row.scopeType as EntityKind | null;
  if (!kind) return null;
  const id =
    kind === "project"
      ? row.projectId
      : kind === "module"
        ? row.moduleId
        : kind === "feature"
          ? row.featureId
          : row.taskId;
  return { kind, id: String(id), projectId: String(row.projectId) };
}

export function sameEntity(a: EntityRef | null, b: EntityRef | null) {
  return (
    !!a &&
    !!b &&
    a.kind === b.kind &&
    a.id === b.id &&
    a.projectId === b.projectId
  );
}
