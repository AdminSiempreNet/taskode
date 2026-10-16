import { requireActor, httpError, assertOrigin } from "@/server/access";
import { NextRequest, NextResponse } from "next/server";
import { commandSchema } from "@/lib/validation";
import { repository } from "@/server";
import { DomainError, isDomainError } from "@/server/repository";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const actor = await requireActor(request);
    return NextResponse.json(await repository().getWorkspace(actor), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return httpError(error);
  }
}
export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).host !== request.headers.get("host"))
        return NextResponse.json(
          { error: "Origen no permitido." },
          { status: 403 },
        );
    } catch {
      return NextResponse.json(
        { error: "Origen no permitido." },
        { status: 403 },
      );
    }
  }
  try {
    assertOrigin(request);
    const actor = await requireActor(request);
    if (Number(request.headers.get("content-length")) > 12 * 1024 * 1024)
      throw new DomainError("El archivo supera el límite de 12 MB.", 413);
    const reader = request.body?.getReader();
    if (!reader) throw new DomainError("Falta el contenido.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > 12 * 1024 * 1024) {
        await reader.cancel();
        throw new DomainError("El archivo supera el límite de 12 MB.", 413);
      }
      chunks.push(chunk.value);
    }
    const content = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const parsed = commandSchema.safeParse(content);
    if (!parsed.success)
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Datos inválidos." },
        { status: 400 },
      );
    const result = await repository().execute(parsed.data, actor);
    return NextResponse.json({
      workspace: await repository().getWorkspace(actor),
      ...result,
    });
  } catch (error) {
    if (isDomainError(error))
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    if (error instanceof SyntaxError)
      return NextResponse.json(
        { error: "El archivo no contiene JSON válido." },
        { status: 400 },
      );
    console.error(error);
    return NextResponse.json(
      { error: "No se pudo guardar el cambio. Vuelve a intentarlo." },
      { status: 500 },
    );
  }
}
