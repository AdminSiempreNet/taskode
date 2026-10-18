import type { Metadata } from "next";
import { DiagramsService } from "@/server/diagrams";
import { repository } from "@/server";
import { isDomainError } from "@/server/repository";
import { PublicDiagramView } from "@/components/diagrams";
import { notFound } from "next/navigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Diagrama compartido",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default async function SharedDiagram({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  try {
    const document = await new DiagramsService(repository()).publicDocument(
      (await params).token,
    );
    return <PublicDiagramView document={document} />;
  } catch (error) {
    if (isDomainError(error) && error.status === 404) notFound();
    throw error;
  }
}
