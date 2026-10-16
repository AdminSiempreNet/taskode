import { WorkspaceApp } from "@/components/workspace-app";
import { redirect } from "next/navigation";
import { projectPath } from "@/lib/routes";
import { repository } from "@/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ project?: string | string[] }>;
}) {
  const workspace = await repository().getWorkspace();
  const { project: legacyProjectId } = await searchParams;
  const project =
    workspace.projects.find((p) => p.id === legacyProjectId) ??
    workspace.projects[0];
  if (project) redirect(projectPath(project.id));
  return <WorkspaceApp initialWorkspace={workspace} />;
}
