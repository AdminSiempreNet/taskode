import { renderEntityPage } from "@/components/entity-page";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export default async function Page({
  params,
}: {
  params: Promise<{ projectId: string; moduleId: string }>;
}) {
  const { projectId, moduleId } = await params;
  return renderEntityPage(projectId, "module", moduleId);
}
