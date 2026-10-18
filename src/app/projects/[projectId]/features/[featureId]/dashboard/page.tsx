import { renderDashboardPage } from "@/components/dashboard-page";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export default async function Page({
  params,
}: {
  params: Promise<{ projectId: string; featureId: string }>;
}) {
  const { projectId, featureId } = await params;
  return renderDashboardPage({ kind: "feature", projectId, id: featureId });
}
