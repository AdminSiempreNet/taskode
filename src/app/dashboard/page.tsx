import { redirect } from "next/navigation";
import { WorkspaceApp } from "@/components/workspace-app";
import { requirePageActor } from "@/server/access";
import { repository } from "@/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const actor = await requirePageActor();
  const workspace = await repository().getWorkspace(actor);
  if (workspace.currentUser.role === "admin" && workspace.onboarding.step < 2)
    redirect("/onboarding");
  return (
    <WorkspaceApp
      initialWorkspace={workspace}
      menuSection="dashboard"
      initialNow={new Date().toISOString()}
    />
  );
}
