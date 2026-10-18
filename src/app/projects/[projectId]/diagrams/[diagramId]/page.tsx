import { notFound } from "next/navigation";
import { requirePageActor } from "@/server/access";
import { repository } from "@/server";
import { DiagramsService } from "@/server/diagrams";
import { isDomainError } from "@/server/repository";
import { StandaloneDiagram } from "@/components/diagrams";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export default async function DiagramPage({
  params,
}: {
  params: Promise<{ projectId: string; diagramId: string }>;
}) {
  const actor = await requirePageActor(),
    { projectId, diagramId } = await params;
  let document;
  try {
    document = await new DiagramsService(repository()).get(actor, diagramId);
  } catch (error) {
    if (isDomainError(error) && error.status === 404) notFound();
    throw error;
  }
  if (document.scope.projectId !== projectId) notFound();
  return <StandaloneDiagram initial={document} />;
}
