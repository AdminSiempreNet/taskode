import type { CallToolResult } from "@modelcontextprotocol/server";

export const MAX_TEXT = 25_000;
const TAG = "contenido_usuario";
const attribute = (value: string) => value.replace(/[\r\n"<>&]/g, " ").slice(0, 200);
// Text written by people (titles, descriptions, comments, documents) is data, never instructions.
// It is delimited so the model can tell it apart; a closing tag inside it cannot end the block.
export function untrusted(
  source: string,
  content: string | null | undefined,
  attributes: Record<string, string | number | null | undefined> = {},
) {
  const attrs = Object.entries({ fuente: source, ...attributes })
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => ` ${key}="${attribute(String(value))}"`)
    .join("");
  const body = (content ?? "").replace(new RegExp(`<(/?)${TAG}`, "gi"), "<​$1" + TAG);
  return `<${TAG}${attrs}>\n${body}\n</${TAG}>`;
}
// Short user text (names, titles) inline: single line, escaped delimiter.
export function inline(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").replace(new RegExp(`<(/?)${TAG}`, "gi"), "<​$1" + TAG).trim();
}
export function clip(text: string, max = MAX_TEXT) {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n[Respuesta recortada a ${max} caracteres: usa filtros, \`limit\` u \`offset\` para ver el resto.]`;
}
export function textResult(text: string, structured?: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: "text", text: clip(text) }],
    ...(structured ? { structuredContent: structured } : {}),
  };
}
export function link(origin: string, path: string) {
  return `${origin}${path}`;
}
// Joins the present lines; accepts `cond && "line"` entries (false, 0, "", null, undefined skip).
export function list(lines: (string | number | false | null | undefined)[]) {
  return lines.filter((line): line is string => typeof line === "string" && line.length > 0).join("\n");
}
export function yesNo(value: boolean) {
  return value ? "sí" : "no";
}
