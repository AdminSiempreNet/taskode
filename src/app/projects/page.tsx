import { requirePageActor } from "@/server/access";
import { WorkspaceApp } from "@/components/workspace-app";
import { redirect } from "next/navigation";
import { projectPath } from "@/lib/routes";
import { repository } from "@/server";

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
  const project = workspace.projects.find((p) => p.id === legacyProjectId);
  if (project) redirect(projectPath(project.id));
  return <WorkspaceApp initialWorkspace={workspace} menuSection="projects" />;
}
