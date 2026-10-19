import { repository } from "@/server";
import { FileManager } from "@/server/files";
import { requireActor, httpError } from "@/server/access";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    return await new FileManager(repository()).content(
      await requireActor(request),
      (await context.params).id,
      new URL(request.url).searchParams.get("download") === "1",
    );
  } catch (error) {
    return httpError(error);
  }
}
