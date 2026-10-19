import type { ApplicationSelection, EntityRelations, Workspace } from "./types";

function withRelations<T extends EntityRelations>(entity: T): T {
  if (entity.clientIds && entity.ticketIds) return entity;
  return { ...entity, clientIds: entity.clientIds ?? [], ticketIds: entity.ticketIds ?? [] };
}
function withApplications<T extends EntityRelations & ApplicationSelection>(entity: T): T {
  return { ...withRelations(entity), applicationIds: entity.applicationIds ?? [] };
}

// Fast Refresh and tabs opened before an update can retain the previous shape.
export function normalizeWorkspaceSnapshot(snapshot: Workspace): Workspace {
  return {
    ...snapshot,
    clients: snapshot.clients ?? [],
    tickets: snapshot.tickets ?? [],
    taskTypes: snapshot.taskTypes ?? [],
    impacts: snapshot.impacts ?? [],
    applications: snapshot.applications ?? [],
    projects: snapshot.projects.map(withRelations),
    modules: snapshot.modules.map(withApplications),
    features: snapshot.features.map(withApplications),
    tasks: snapshot.tasks.map(withApplications),
  };
}
