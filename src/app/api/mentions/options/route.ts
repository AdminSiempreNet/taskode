import { assertOrigin, httpError, requireActor } from "@/server/access";
import { repository } from "@/server";
import { MentionsService } from "@/server/mentions";
import { mentionContextSchema } from "@/lib/mentions";
import { DomainError } from "@/server/repository";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const actor = await requireActor(request);
    const reader = request.body?.getReader();
    if (!reader) throw new DomainError("Falta el contexto de menciones.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > 32_768) {
        await reader.cancel();
        throw new DomainError("Contexto demasiado grande.", 413);
      }
      chunks.push(chunk.value);
    }
    const context = mentionContextSchema.safeParse(
      JSON.parse(Buffer.concat(chunks).toString("utf8")),
    );
    if (!context.success)
      throw new DomainError("Contexto de menciones inválido.");
    return Response.json(
      await new MentionsService(repository()).options(actor, context.data),
      {
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  } catch (error) {
    return error instanceof SyntaxError
      ? Response.json(
          { error: "Contexto de menciones inválido." },
          { status: 400 },
        )
      : httpError(error);
  }
}
