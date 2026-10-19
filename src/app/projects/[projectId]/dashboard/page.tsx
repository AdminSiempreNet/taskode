import { renderDashboardPage } from "@/components/dashboard-page";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export default async function Page({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return renderDashboardPage({ kind: "project", projectId, id: projectId });
}
