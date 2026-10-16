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
  const workspace = await repository().getWorkspace();
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
