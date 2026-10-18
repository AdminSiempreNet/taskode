import { renderDashboardPage } from "@/components/dashboard-page";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export default async function Page({
  params,
}: {
  params: Promise<{ projectId: string; moduleId: string }>;
}) {
  const { projectId, moduleId } = await params;
  return renderDashboardPage({ kind: "module", projectId, id: moduleId });
}
