import { z } from "zod";
import type { EntityPermissions, EntityRef } from "./types";

export const MAX_DIAGRAM_BYTES = 3_000_000;
const elementSchema = z.looseObject({
  id: z.string().min(1).max(200),
  type: z.enum([
    "rectangle",
    "diamond",
    "ellipse",
    "line",
    "arrow",
    "text",
    "image",
    "freedraw",
    "frame",
    "magicframe",
  ]),
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().nonnegative(),
  height: z.number().finite().nonnegative(),
  isDeleted: z.boolean().optional(),
  fileId: z.string().nullable().optional(),
});
const imageSchema = z.strictObject({
  id: z.string().min(1).max(200),
  mimeType: z.enum([
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "image/avif",
  ]),
  dataURL: z
    .string()
    .regex(/^data:image\/(?:png|jpeg|gif|webp|avif);base64,[A-Za-z0-9+/=]+$/),
  created: z.number().finite(),
  lastRetrieved: z.number().finite().optional(),
});
export const diagramSceneSchema = z
  .strictObject({
    elements: z.array(elementSchema).max(10_000),
    appState: z.strictObject({ viewBackgroundColor: z.string().max(100) }),
    files: z.record(z.string().max(200), imageSchema),
  })
  .superRefine((scene, context) => {
    const ids = new Set<string>();
    for (const element of scene.elements) {
      if (ids.has(element.id))
        context.addIssue({
          code: "custom",
          message: "Identificador de elemento repetido.",
        });
      ids.add(element.id);
      if (
        element.type === "image" &&
        !element.isDeleted &&
        (!element.fileId || !scene.files[element.fileId])
      )
        context.addIssue({
          code: "custom",
          message: "Falta una imagen del diagrama.",
        });
    }
    for (const [id, file] of Object.entries(scene.files)) {
      if (
        id !== file.id ||
        !file.dataURL.startsWith(`data:${file.mimeType};base64,`)
      )
        context.addIssue({ code: "custom", message: "Imagen inválida." });
    }
  });
export type DiagramScene = z.infer<typeof diagramSceneSchema>;
export const emptyDiagramScene = (): DiagramScene => ({
  elements: [],
  appState: { viewBackgroundColor: "#ffffff" },
  files: {},
});
export const diagramInputSchema = z.strictObject({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(1_000),
  scene: diagramSceneSchema,
});
export const diagramSaveSchema = diagramInputSchema.extend({
  revision: z.number().int().positive(),
});
export type DiagramInput = z.infer<typeof diagramInputSchema>;
export interface DiagramSummary {
  id: string;
  title: string;
  description: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  isPublic: boolean;
}
export interface DiagramDocument extends DiagramSummary {
  scope: EntityRef;
  scene: DiagramScene;
  permissions: EntityPermissions;
  publicPath?: string | null;
}
export interface PublicDiagram {
  title: string;
  description: string;
  scene: DiagramScene;
}
export function diagramBytes(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}
// JSONB reorders object keys. Compare document content, never its wire ordering.
export function sceneFingerprint(scene: DiagramScene) {
  return JSON.stringify(scene, (_key, value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, value[key]]),
        )
      : value,
  );
}
export function diagramBackPath(scope: EntityRef, id?: string) {
  const root = `/projects/${encodeURIComponent(scope.projectId)}`;
  const path =
    scope.kind === "project"
      ? `${root}/details`
      : `${root}/${scope.kind === "module" ? "modules" : scope.kind === "feature" ? "features" : "tasks"}/${encodeURIComponent(scope.id)}`;
  return `${path}?tab=diagrams${id ? `&diagram=${encodeURIComponent(id)}` : ""}`;
}
