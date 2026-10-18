import { renderEntityPage } from "@/components/entity-page";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export default async function Page({
  params,
}: {
  params: Promise<{ projectId: string; featureId: string }>;
}) {
  const { projectId, featureId } = await params;
  return renderEntityPage(projectId, "feature", featureId);
}
