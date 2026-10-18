import { z } from "zod";
import type { EntityPermissions, EntityRef } from "./types";
import type { DiagramSummary } from "./diagrams";

export const MAX_DOCUMENT_BYTES = 130_000;
export const documentInputSchema = z.strictObject({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(1_000),
  content: z.string().max(30_000),
});
export const documentSaveSchema = documentInputSchema.extend({
  revision: z.number().int().positive(),
});
export type DocumentInput = z.infer<typeof documentInputSchema>;
export interface DocumentSummary {
  id: string;
  title: string;
  description: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}
export interface DocumentDetail extends DocumentSummary {
  scope: EntityRef;
  content: string;
  permissions: EntityPermissions;
}
export interface DocumentDiagramOption extends DiagramSummary {
  scope: EntityRef;
}

// A standalone, ordinary Markdown link is also useful outside this application.
export function diagramReferencePath(projectId: string, diagramId: string) {
  return `/projects/${encodeURIComponent(projectId)}/diagrams/${encodeURIComponent(diagramId)}`;
}
export function parseDiagramReference(href: unknown) {
  if (typeof href !== "string") return null;
  const match = /^\/projects\/([^/?#]+)\/diagrams\/([a-f0-9-]{36})$/.exec(href);
  if (!match) return null;
  try {
    return { projectId: decodeURIComponent(match[1]), diagramId: match[2] };
  } catch {
    return null;
  }
}
