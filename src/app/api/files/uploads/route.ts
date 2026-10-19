import { z } from "zod";
import { repository } from "@/server";
import { FileManager } from "@/server/files";
import { assertOrigin, requireActor, httpError } from "@/server/access";
import { DomainError } from "@/server/repository";
import { entityRefSchema } from "@/lib/validation";
export const runtime = "nodejs";
const input = z.object({
  projectId: z.string().min(1).max(200),
  taskId: z.string().min(1).max(200).optional(),
  scope: entityRefSchema.optional(),
  name: z.string().min(1).max(500),
  size: z.number().int().positive(),
  purpose: z.enum(["image", "file", "document"]).transform((value) => value === "document" ? "file" as const : value),
});
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const actor = await requireActor(request);
    const parsed = input.safeParse(await request.json());
    if (!parsed.success) throw new DomainError("Datos de archivo inválidos.");
    return Response.json(
      await new FileManager(repository()).begin(actor, parsed.data),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return httpError(error);
  }
}
