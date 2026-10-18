import { eq } from "drizzle-orm";
import { repository } from "@/server";
import { httpError, requireActor } from "@/server/access";
import { user, projectTeamMembers } from "@/server/schema";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const repo = repository(),
      actor = await requireActor(request),
      projectId = new URL(request.url).searchParams.get("projectId");
    if (projectId) await repo.requireProject(actor, projectId, true);
    else await repo.requireAdmin(actor);
    const users = await repo.store.db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        role: user.role,
      })
      .from(user);
    const members = projectId
      ? await repo.store.db
          .select()
          .from(projectTeamMembers)
          .where(eq(projectTeamMembers.projectId, projectId))
      : [];
    return Response.json(
      {
        users,
        teamMemberIds: members.map((m) => m.userId),
        members: members.map((m) => m.userId),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return httpError(error);
  }
}
