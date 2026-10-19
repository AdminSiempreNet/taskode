import { redirect } from "next/navigation";
import { WorkspaceApp } from "@/components/workspace-app";
import { requirePageActor } from "@/server/access";
import { repository } from "@/server";
import { CatalogsService } from "@/server/catalogs";
import { paginationSchema } from "@/lib/pagination";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  const actor = await requirePageActor();
  const repo = repository();
  const [workspace, clientsPage] = await Promise.all([
    repo.getWorkspace(actor, { includeCatalogs: false }),
    new CatalogsService(repo).clients(actor, paginationSchema.parse({})),
  ]);
  if (workspace.currentUser.role === "admin" && workspace.onboarding.step < 2)
    redirect("/onboarding");
  return <WorkspaceApp initialWorkspace={workspace} menuSection="clients" initialClientsPage={clientsPage} />;
}
