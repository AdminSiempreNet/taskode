import { requirePageActor } from "@/server/access";
import { WorkspaceApp } from "@/components/workspace-app";
import { redirect } from "next/navigation";
import { projectPath } from "@/lib/routes";
import { repository } from "@/server";
import { cookies } from "next/headers";
import {
  lastProjectCookieName,
  resolveDefaultProject,
} from "@/lib/project-navigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export default async function Projects({
  searchParams,
}: {
  searchParams: Promise<{ project?: string | string[] }>;
}) {
  const actor = await requirePageActor();
  const workspace = await repository().getWorkspace(actor);
  if (workspace.currentUser.role === "admin" && workspace.onboarding.step < 2)
    redirect("/onboarding");
  const { project: legacyProjectId } = await searchParams;
  const savedProject = (await cookies()).get(
    lastProjectCookieName(actor.id),
  )?.value;
  const project = resolveDefaultProject(
    workspace.projects,
    legacyProjectId,
    savedProject,
  );
  if (project) redirect(projectPath(project.id));
  return <WorkspaceApp initialWorkspace={workspace} />;
}
