import { notFound, redirect } from "next/navigation";
import { requirePageActor } from "@/server/access";
import { repository } from "@/server";
import { isDomainError } from "@/server/repository";
import { WorkspaceApp } from "./workspace-app";
import type { EntityKind } from "@/lib/types";

export async function renderEntityPage(
  projectId: string,
  kind: Exclude<EntityKind, "task">,
  id: string,
) {
  const actor = await requirePageActor();
  const workspace = await repository().getWorkspace(actor);
  if (workspace.currentUser.role === "admin" && workspace.onboarding.step < 2)
    redirect("/onboarding");
  if (!workspace.projects.some((p) => p.id === projectId)) notFound();
  let detail;
  if (!(kind === "module" && id === "general")) {
    try {
      detail = await repository().entityDetail(actor, kind, id, projectId);
    } catch (error) {
      if (isDomainError(error) && error.status === 404) notFound();
      throw error;
    }
  }
  return (
    <WorkspaceApp
      key={`${projectId}/${kind}/${id}`}
      projectId={projectId}
      initialWorkspace={workspace}
      entityRoute={{ kind, id }}
      initialEntityDetail={detail}
    />
  );
}
