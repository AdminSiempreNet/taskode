import { redirect } from "next/navigation";
import { requirePageActor } from "@/server/access";
import { notFound } from "next/navigation";
import { WorkspaceApp } from "@/components/workspace-app";
import { repository } from "@/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function TaskPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string; taskId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { projectId, taskId } = await params;
  const query = await searchParams;
  const actor = await requirePageActor();
  const workspace = await repository().getWorkspace(actor);
  if (workspace.currentUser.role === "admin" && workspace.onboarding.step < 2) redirect("/onboarding");
  if (
    !workspace.projects.some((project) => project.id === projectId) ||
    (taskId !== "new" &&
      !workspace.tasks.some(
        (task) => task.id === taskId && task.projectId === projectId,
      ))
  )
    notFound();
  const value = (key: string) =>
    typeof query[key] === "string" ? query[key] : undefined;
  return (
    <WorkspaceApp
      key={`${projectId}/${taskId}`}
      initialWorkspace={workspace}
      projectId={projectId}
      taskId={taskId === "new" ? undefined : taskId}
      initialTaskCreation={
        taskId === "new"
          ? {
              featureId: value("featureId"),
              statusId: value("statusId"),
              dueDate: value("dueDate"),
              dueTime: value("dueTime"),
            }
          : undefined
      }
      taskDefaults={{
        featureId: value("featureId"),
        statusId: value("statusId"),
        dueDate: value("dueDate"),
        dueTime: value("dueTime"),
      }}
    />
  );
}
