import { redirect } from "next/navigation";
import { getActor } from "@/server/access";
import { repository } from "@/server";
import { WorkspaceApp } from "@/components/workspace-app";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export default async function Users({ searchParams }: { searchParams: Promise<{ user?: string }> }) {
  const query = await searchParams;
  const selected = query.user && /^[a-zA-Z0-9_-]{1,200}$/.test(query.user) ? query.user : null;
  const actor = await getActor();
  if (!actor) redirect(`/login?returnTo=${encodeURIComponent(`/users${selected ? `?user=${selected}` : ""}`)}`);
  const repo = repository();
  const user = await repo.currentUser(actor);
  if (user.role !== "admin") redirect("/projects");
  await repo.requireAdmin(actor);
  const workspace = await repo.getWorkspace(actor);
  if (workspace.onboarding.step < 2) redirect("/onboarding");
  return <WorkspaceApp initialWorkspace={workspace} menuSection="users" />;
}
