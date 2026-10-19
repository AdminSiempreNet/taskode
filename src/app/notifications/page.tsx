import { redirect } from "next/navigation";
import { getActor } from "@/server/access";
import { repository } from "@/server";
import { WorkspaceApp } from "@/components/workspace-app";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export default async function Notifications({
  searchParams,
}: {
  searchParams: Promise<{ open?: string }>;
}) {
  const query = await searchParams;
  const openId =
    query.open && /^[a-f0-9-]{36}$/.test(query.open) ? query.open : undefined;
  const actor = await getActor();
  if (!actor)
    redirect(
      `/login?returnTo=${encodeURIComponent(`/notifications${openId ? `?open=${openId}` : ""}`)}`,
    );
  const workspace = await repository().getWorkspace(actor);
  if (workspace.currentUser.role === "admin" && workspace.onboarding.step < 2)
    redirect("/onboarding");
  return (
    <WorkspaceApp
      initialWorkspace={workspace}
      menuSection="notifications"
      notificationOpenId={openId}
    />
  );
}
