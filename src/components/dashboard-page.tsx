import { notFound, redirect } from "next/navigation";
import { canViewDashboard, type DashboardScope } from "@/lib/dashboard";
import { requirePageActor } from "@/server/access";
import { repository } from "@/server";
import { WorkspaceApp } from "./workspace-app";

export async function renderDashboardPage(scope: DashboardScope) {
  const actor = await requirePageActor();
  const workspace = await repository().getWorkspace(actor);
  if (workspace.currentUser.role === "admin" && workspace.onboarding.step < 2)
    redirect("/onboarding");
  if (!canViewDashboard(workspace, scope)) notFound();
  return (
    <WorkspaceApp
      key={`dashboard/${scope.kind}/${scope.id}`}
      projectId={scope.projectId}
      initialWorkspace={workspace}
      dashboardScope={scope}
      initialNow={new Date().toISOString()}
    />
  );
}
