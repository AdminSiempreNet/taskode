import { redirect } from "next/navigation";
import { requirePageActor } from "@/server/access";
import { notFound } from "next/navigation";
import { WorkspaceApp } from "@/components/workspace-app";
import { repository } from "@/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const actor = await requirePageActor();
  const workspace = await repository().getWorkspace(actor);
  if (workspace.currentUser.role === "admin" && workspace.onboarding.step < 2) redirect("/onboarding");
  if (!workspace.projects.some((project) => project.id === projectId))
    notFound();

  return (
    <WorkspaceApp
      key={projectId}
      projectId={projectId}
      initialWorkspace={workspace}
    />
  );
}
