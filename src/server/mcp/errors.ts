import { ZodError } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { isDomainError } from "../repository";

const HINTS: Record<number, string> = {
  401: "La autorización ya no es válida; vuelve a conectar la aplicación.",
  403: "Tu cuenta no tiene permiso para esta acción en ese elemento.",
  404: "No existe o no tienes acceso. Comprueba el id con una herramienta de búsqueda.",
  409: "El elemento cambió desde que lo leíste: vuelve a leerlo y repite la operación.",
  413: "El contenido supera el tamaño permitido.",
  429: "Demasiadas operaciones seguidas; espera un minuto.",
};
export function errorStatus(error: unknown) {
  return isDomainError(error) ? error.status : error instanceof ZodError ? 400 : 500;
}
// Domain and validation errors become tool errors the model can act on, in Spanish.
export function toolError(error: unknown): CallToolResult {
  let text: string;
  if (isDomainError(error)) {
    const hint = HINTS[error.status];
    text = hint && !error.message.includes(hint) ? `${error.message} ${hint}` : error.message;
  } else if (error instanceof ZodError) {
    text = `Datos inválidos: ${error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join(".") || "entrada"}: ${issue.message}`)
      .join("; ")}`;
  } else {
    console.error("[mcp] tool failed", error);
    text = "No se pudo completar la operación. Vuelve a intentarlo.";
  }
  return { isError: true, content: [{ type: "text", text }] };
}
