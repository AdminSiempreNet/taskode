import { randomInt, randomUUID } from "node:crypto";
import { z } from "zod";
import type { DiagramScene } from "../../lib/diagrams";

// Elements an agent can describe without knowing Excalidraw's full model.
export const simpleElementSchema = z.object({
  type: z.enum(["rectangle", "ellipse", "diamond", "text", "arrow", "line"]),
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().nonnegative().optional().describe("Ancho (formas) o desplazamiento horizontal (flechas/líneas)."),
  height: z.number().finite().optional().describe("Alto (formas) o desplazamiento vertical (flechas/líneas)."),
  text: z.string().max(2000).optional().describe("Texto del elemento de texto, o etiqueta centrada dentro de una forma."),
  strokeColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  backgroundColor: z.string().regex(/^(#[0-9a-fA-F]{6}|transparent)$/).optional(),
  fontSize: z.number().int().min(8).max(120).optional(),
});
export type SimpleElement = z.infer<typeof simpleElementSchema>;
type Element = DiagramScene["elements"][number];

function base(type: Element["type"], x: number, y: number, width: number, height: number, input: SimpleElement) {
  return {
    id: randomUUID(),
    type,
    x,
    y,
    width,
    height,
    angle: 0,
    strokeColor: input.strokeColor ?? "#1e1e1e",
    backgroundColor: input.backgroundColor ?? "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [] as string[],
    frameId: null,
    roundness: type === "rectangle" ? { type: 3 } : null,
    seed: randomInt(1, 2 ** 31 - 1),
    version: 1,
    versionNonce: randomInt(1, 2 ** 31 - 1),
    isDeleted: false,
    boundElements: null,
    updated: Date.now(),
    link: null,
    locked: false,
  };
}
function textElement(text: string, x: number, y: number, input: SimpleElement, align: "left" | "center" = "left") {
  const fontSize = input.fontSize ?? 20;
  const lines = text.split("\n");
  const width = Math.max(...lines.map((line) => line.length)) * fontSize * 0.55;
  const height = lines.length * fontSize * 1.25;
  return {
    ...base("text", align === "center" ? x - width / 2 : x, align === "center" ? y - height / 2 : y, width, height, input),
    backgroundColor: "transparent",
    text,
    originalText: text,
    fontSize,
    fontFamily: 5,
    textAlign: align,
    verticalAlign: align === "center" ? "middle" : "top",
    containerId: null,
    autoResize: true,
    lineHeight: 1.25,
  } as unknown as Element;
}
export function buildElements(inputs: SimpleElement[]): Element[] {
  const elements: Element[] = [];
  for (const input of inputs) {
    if (input.type === "text") {
      elements.push(textElement(input.text ?? "", input.x, input.y, input));
      continue;
    }
    if (input.type === "arrow" || input.type === "line") {
      const dx = input.width ?? 100,
        dy = input.height ?? 0;
      elements.push({
        ...base(input.type, input.x, input.y, Math.abs(dx), Math.abs(dy), input),
        points: [
          [0, 0],
          [dx, dy],
        ],
        lastCommittedPoint: null,
        startBinding: null,
        endBinding: null,
        startArrowhead: null,
        endArrowhead: input.type === "arrow" ? "arrow" : null,
        elbowed: false,
      } as unknown as Element);
      continue;
    }
    const width = input.width ?? 160,
      height = Math.abs(input.height ?? 80);
    elements.push(base(input.type, input.x, input.y, width, height, input) as unknown as Element);
    if (input.text)
      elements.push(textElement(input.text, input.x + width / 2, input.y + height / 2, input, "center"));
  }
  return elements;
}
// A readable outline of a scene: element counts and the visible texts.
export function summarizeScene(scene: DiagramScene) {
  const visible = scene.elements.filter((element) => !element.isDeleted);
  const counts = new Map<string, number>();
  for (const element of visible) counts.set(element.type, (counts.get(element.type) ?? 0) + 1);
  const texts = visible
    .map((element) => (element as { text?: unknown }).text)
    .filter((text): text is string => typeof text === "string" && text.trim().length > 0);
  const xs = visible.flatMap((element) => [element.x, element.x + element.width]);
  const ys = visible.flatMap((element) => [element.y, element.y + element.height]);
  return {
    elements: visible.length,
    byType: Object.fromEntries(counts),
    images: Object.keys(scene.files).length,
    texts,
    bounds: visible.length
      ? { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }
      : null,
  };
}
export function withoutImageData(scene: DiagramScene) {
  return {
    ...scene,
    files: Object.fromEntries(
      Object.entries(scene.files).map(([id, file]) => [id, { id: file.id, mimeType: file.mimeType, created: file.created }]),
    ),
  };
}
