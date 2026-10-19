import type { EntityRelations, Workspace } from "./types";

function withRelations<T extends EntityRelations>(entity: T): T {
  if (entity.clientIds && entity.ticketIds) return entity;
  return { ...entity, clientIds: entity.clientIds ?? [], ticketIds: entity.ticketIds ?? [] };
}

// Fast Refresh and tabs opened before an update can retain the previous shape.
export function normalizeWorkspaceSnapshot(snapshot: Workspace): Workspace {
  return {
    ...snapshot,
    clients: snapshot.clients ?? [],
    tickets: snapshot.tickets ?? [],
    taskTypes: snapshot.taskTypes ?? [],
    impacts: snapshot.impacts ?? [],
    projects: snapshot.projects.map(withRelations),
    modules: snapshot.modules.map(withRelations),
    features: snapshot.features.map(withRelations),
    tasks: snapshot.tasks.map(withRelations),
  };
}
