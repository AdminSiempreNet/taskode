"use client";
import { useEffect, useState } from "react";
import type {
  CurrentUser,
  Project,
  ProjectPerson,
  EntityRef,
} from "@/lib/types";
import { fetchJSON } from "@/lib/http-client";
import type { Mutate } from "./forms";
import { EntityAssignments } from "./task-people";

export function EntityAssignmentControl({
  scope,
  leaderId,
  teamMemberIds,
  people,
  currentUser,
  canManage,
  mutate,
  busy,
  initialOpen,
  hideTrigger,
  onClose,
}: {
  scope: EntityRef;
  leaderId: string;
  teamMemberIds: string[];
  people: ProjectPerson[];
  currentUser: CurrentUser;
  canManage: boolean;
  mutate: Mutate;
  busy: boolean;
  initialOpen?: boolean;
  hideTrigger?: boolean;
  onClose?: () => void;
}) {
  const [candidates, setCandidates] = useState<ProjectPerson[] | null>(null);
  const [error, setError] = useState("");
  const loadAll = scope.kind === "project" && canManage;
  useEffect(() => {
    if (!loadAll) return;
    const controller = new AbortController();
    setError("");
    setCandidates(null);
    void fetchJSON<{ users: Omit<ProjectPerson, "projectId">[] }>(
      `/api/users?projectId=${encodeURIComponent(scope.projectId)}`,
      { signal: controller.signal },
    )
      .then(({ users }) =>
        setCandidates(
          users.map((person) => ({ ...person, projectId: scope.projectId })),
        ),
      )
      .catch((error) => {
        if (!controller.signal.aborted)
          setError(
            error instanceof Error
              ? error.message
              : "No se pudieron cargar los usuarios.",
          );
      });
    return () => controller.abort();
  }, [loadAll, scope.projectId]);
  return (
    <EntityAssignments
      people={loadAll ? (candidates ?? people) : people}
      leaderId={leaderId}
      teamMemberIds={teamMemberIds}
      canManage={canManage}
      canChangeLeader={
        canManage && (scope.kind !== "project" || currentUser.role === "admin")
      }
      busy={busy || (loadAll && !candidates && !error)}
      error={error}
      initialOpen={initialOpen}
      hideTrigger={hideTrigger}
      onClose={onClose}
      onSave={async (leaderId, teamMemberIds) =>
        !!(await mutate({
          type: `${scope.kind}.assignment.update`,
          id: scope.id,
          leaderId,
          teamMemberIds,
        }))
      }
    />
  );
}

export function ProjectPeopleModal({
  project,
  currentUser,
  mutate,
  close,
}: {
  project: Project;
  currentUser: CurrentUser;
  mutate: Mutate;
  close: () => void;
}) {
  return (
    <EntityAssignmentControl
      scope={{ kind: "project", id: project.id, projectId: project.id }}
      leaderId={project.leaderId}
      teamMemberIds={project.teamMemberIds ?? []}
      people={[]}
      currentUser={currentUser}
      canManage={
        currentUser.role === "admin" || currentUser.id === project.leaderId
      }
      mutate={mutate}
      busy={false}
      initialOpen
      hideTrigger
      onClose={close}
    />
  );
}
