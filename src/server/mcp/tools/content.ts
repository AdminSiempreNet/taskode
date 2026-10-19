import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { fileUrl } from "../../../lib/files";
import type { DiagramScene } from "../../../lib/diagrams";
import { DiagramsService } from "../../diagrams";
import { DocumentsService } from "../../documents";
import { FileManager } from "../../files";
import { DomainError } from "../../repository";
import type { McpContext } from "../context";
import { defineTool } from "../define";
import { buildElements, simpleElementSchema, summarizeScene, withoutImageData } from "../diagram-elements";
import { entityUrl, resolveEntity } from "../domain";
import { inline, link, list, textResult, untrusted } from "../format";
import { confirm, entity, id, textMode } from "../schemas";

const WRITE = { readOnlyHint: false, destructiveHint: false } as const;
// Vercel limits request bodies to 4.5 MB; base64 adds a third.
export const MAX_UPLOAD_BYTES = 2_500_000;
const MAX_IMAGE_RESULT = 1_000_000;
const MAX_FILE_RESULT = 2_000_000;
const normalize = (value: string) => value.normalize("NFC").trim();

export function registerContentTools(server: McpServer, ctx: McpContext) {
  const documents = new DocumentsService(ctx.repo);
  const diagrams = new DiagramsService(ctx.repo);

  defineTool(server, ctx, {
    name: "get_document",
    title: "Leer documento",
    description: "Devuelve un documento (Markdown) con su revisión. Necesitas la revisión para modificarlo con save_document.",
    access: "read",
    input: z.object({ documentId: id }),
    run: async ({ documentId }) => {
      const doc = await documents.get(ctx.actor, documentId);
      return textResult(
        [
          `# Documento: ${inline(doc.title)}`,
          list([
            `- id: \`${doc.id}\` · revisión ${doc.revision} · actualizado ${doc.updatedAt}`,
            `- pertenece a: ${doc.scope.kind} \`${doc.scope.id}\` (${entityUrl(ctx, doc.scope.projectId, doc.scope.kind, doc.scope.id)})`,
            doc.description && `- resumen: ${inline(doc.description)}`,
            `- puedes editar: ${doc.permissions.canEdit ? "sí" : "no"}`,
          ]),
          untrusted("documento", doc.content, { id: doc.id }),
        ].join("\n\n"),
        { id: doc.id, revision: doc.revision, title: doc.title, description: doc.description, scope: doc.scope },
      );
    },
  });

  defineTool(server, ctx, {
    name: "save_document",
    title: "Crear o editar documento",
    description:
      "Crea un documento Markdown en un elemento (sin documentId) o lo modifica (con documentId y la revisión leída con get_document; si otra persona lo cambió, falla y debes volver a leerlo). Admite menciones y diagramas enlazados.",
    access: "write",
    annotations: WRITE,
    input: z.object({
      documentId: id.optional(),
      entity: entity.optional().describe("Solo al crear."),
      revision: z.number().int().positive().optional().describe("Obligatoria al modificar."),
      title: z.string().min(1).max(160).optional(),
      description: z.string().max(1000).optional(),
      content: z.string().max(30000).optional(),
      contentMode: textMode,
    }),
    target: (args) => ({ type: "document", id: args.documentId ?? args.entity?.id }),
    run: async ({ documentId, entity: target, revision, title, description, content, contentMode }) => {
      let doc;
      if (!documentId) {
        if (!target || !title) throw new DomainError("Indica el elemento y el título del documento.");
        doc = await documents.create(ctx.actor, target.kind, target.id, {
          title,
          description: description ?? "",
          content: content ?? "",
        });
      } else {
        if (!revision) throw new DomainError("Indica la revisión leída con get_document.");
        const current = await documents.get(ctx.actor, documentId);
        const next =
          content === undefined
            ? current.content
            : contentMode === "append" && current.content
              ? `${current.content}\n\n${content}`
              : content;
        doc = await documents.save(ctx.actor, documentId, revision, {
          title: title ?? current.title,
          description: description ?? current.description,
          content: next,
        });
      }
      ctx.effects.notifications();
      return textResult(`Documento guardado (id: \`${doc.id}\`, revisión ${doc.revision}).`, { id: doc.id, revision: doc.revision });
    },
  });

  defineTool(server, ctx, {
    name: "get_diagram",
    title: "Ver diagrama",
    description:
      "Devuelve un diagrama de Excalidraw: resumen legible (textos, número de elementos) o la escena completa en JSON. Las imágenes incrustadas se omiten salvo includeImages.",
    access: "read",
    input: z.object({
      diagramId: id,
      format: z.enum(["summary", "scene"]).default("summary"),
      includeImages: z.boolean().default(false),
    }),
    run: async ({ diagramId, format, includeImages }) => {
      const diagram = await diagrams.get(ctx.actor, diagramId);
      const summary = summarizeScene(diagram.scene);
      const header = list([
        `# Diagrama: ${inline(diagram.title)}`,
        `- id: \`${diagram.id}\` · revisión ${diagram.revision} · actualizado ${diagram.updatedAt}`,
        `- pertenece a: ${diagram.scope.kind} \`${diagram.scope.id}\``,
        `- enlace: ${link(ctx.origin, `/projects/${encodeURIComponent(diagram.scope.projectId)}/diagrams/${encodeURIComponent(diagram.id)}`)}`,
        diagram.publicPath && `- enlace público: ${link(ctx.origin, diagram.publicPath)}`,
        `- elementos: ${summary.elements} (${Object.entries(summary.byType).map(([type, total]) => `${type} ${total}`).join(", ") || "ninguno"}) · imágenes ${summary.images}`,
      ]);
      if (format === "summary")
        return textResult(
          [
            header,
            diagram.description && untrusted("descripcion", diagram.description, { diagrama: diagram.id }),
            "## Textos",
            summary.texts.length ? untrusted("diagrama", summary.texts.join("\n"), { id: diagram.id }) : "_Sin textos._",
          ]
            .filter(Boolean)
            .join("\n\n"),
          { id: diagram.id, revision: diagram.revision, summary },
        );
      const scene = includeImages ? diagram.scene : withoutImageData(diagram.scene);
      return {
        content: [
          { type: "text", text: `${header}\n\nLa escena completa va adjunta como JSON. Los textos son contenido de usuario.` },
          {
            type: "resource",
            resource: {
              uri: `taskode://diagrams/${diagram.id}/scene.json`,
              mimeType: "application/json",
              text: JSON.stringify(scene),
            },
          },
        ],
        structuredContent: { id: diagram.id, revision: diagram.revision },
      };
    },
  });

  defineTool(server, ctx, {
    name: "save_diagram",
    title: "Crear o editar diagrama",
    description:
      "Crea un diagrama (sin diagramId) o lo modifica (con diagramId y revisión). Describe los elementos de forma sencilla (rectángulos, elipses, rombos, textos, flechas y líneas con coordenadas) o envía una escena Excalidraw completa. mode=append añade elementos a los existentes.",
    access: "write",
    annotations: WRITE,
    input: z.object({
      diagramId: id.optional(),
      entity: entity.optional().describe("Solo al crear."),
      revision: z.number().int().positive().optional().describe("Obligatoria al modificar."),
      title: z.string().min(1).max(160).optional(),
      description: z.string().max(1000).optional(),
      elements: z.array(simpleElementSchema).max(500).optional(),
      scene: z.record(z.string(), z.unknown()).optional().describe("Escena Excalidraw completa {elements, appState, files}."),
      mode: z.enum(["replace", "append"]).default("append"),
    }),
    target: (args) => ({ type: "diagram", id: args.diagramId ?? args.entity?.id }),
    run: async ({ diagramId, entity: target, revision, title, description, elements, scene, mode }) => {
      const built = elements ? buildElements(elements) : [];
      let saved;
      if (!diagramId) {
        if (!target || !title) throw new DomainError("Indica el elemento y el título del diagrama.");
        saved = await diagrams.create(ctx.actor, target.kind, target.id, {
          title,
          description: description ?? "",
          scene: scene ?? { elements: built, appState: { viewBackgroundColor: "#ffffff" }, files: {} },
        });
      } else {
        if (!revision) throw new DomainError("Indica la revisión leída con get_diagram.");
        const current = await diagrams.get(ctx.actor, diagramId);
        const nextScene: DiagramScene | Record<string, unknown> =
          scene ??
          (elements
            ? {
                ...current.scene,
                elements: mode === "append" ? [...current.scene.elements, ...built] : built,
                files: mode === "append" ? current.scene.files : {},
              }
            : current.scene);
        saved = await diagrams.save(ctx.actor, diagramId, revision, {
          title: title ?? current.title,
          description: description ?? current.description,
          scene: nextScene,
        });
      }
      return textResult(
        `Diagrama guardado (id: \`${saved.id}\`, revisión ${saved.revision}): ${link(ctx.origin, `/projects/${encodeURIComponent(saved.scope.projectId)}/diagrams/${encodeURIComponent(saved.id)}`)}`,
        { id: saved.id, revision: saved.revision },
      );
    },
  });

  defineTool(server, ctx, {
    name: "share_diagram",
    title: "Compartir diagrama públicamente",
    description:
      "Activa o revoca el enlace público de solo lectura de un diagrama. Activarlo hace el diagrama visible para cualquiera con el enlace: confirma con la persona y pasa el título exacto en confirm.",
    access: "write",
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: true },
    input: z.object({ diagramId: id, enabled: z.boolean(), confirm: confirm.optional() }),
    target: (args) => ({ type: "diagram", id: args.diagramId }),
    run: async ({ diagramId, enabled, confirm: confirmation }) => {
      if (enabled) {
        const current = await diagrams.get(ctx.actor, diagramId);
        if (!confirmation || normalize(confirmation) !== normalize(current.title))
          throw new DomainError("Para publicar el diagrama, escribe en confirm su título exacto.");
      }
      const diagram = await diagrams.share(ctx.actor, diagramId, enabled);
      return enabled && diagram.publicPath
        ? `Enlace público activo: ${link(ctx.origin, diagram.publicPath)}`
        : "Enlace público revocado.";
    },
  });

  defineTool(server, ctx, {
    name: "get_file",
    title: "Ver archivo",
    description:
      "Devuelve un archivo adjunto: metadatos o su contenido (imágenes de hasta 1 MB como imagen; otros archivos de hasta 2 MB como recurso).",
    access: "read",
    input: z.object({ fileId: id, mode: z.enum(["metadata", "content"]).default("metadata") }),
    run: async ({ fileId, mode }) => {
      const limit = mode === "metadata" ? 0 : MAX_FILE_RESULT;
      const file = await new FileManager(ctx.repo).read(ctx.actor, fileId, limit);
      const meta = `${inline(file.name)} · ${file.mimeType} · ${file.size} bytes (id: \`${file.id}\`) · ${link(ctx.origin, fileUrl(file.id))}`;
      if (!file.bytes) return textResult(mode === "content" ? `${meta}\n\nEl archivo supera el tamaño que se puede devolver aquí.` : meta);
      const data = file.bytes.toString("base64");
      if (file.mimeType.startsWith("image/") && file.size <= MAX_IMAGE_RESULT)
        return { content: [{ type: "text", text: meta }, { type: "image", data, mimeType: file.mimeType }] };
      return {
        content: [
          { type: "text", text: meta },
          { type: "resource", resource: { uri: `taskode://files/${file.id}`, mimeType: file.mimeType, blob: data } },
        ],
      };
    },
  });

  defineTool(server, ctx, {
    name: "upload_file",
    title: "Adjuntar archivo",
    description: `Adjunta un archivo (pdf, doc, docx, xls, xlsx, jpg, png, gif, webp, avif) a un elemento, enviado en base64 (máximo ${MAX_UPLOAD_BYTES / 1_000_000} MB). Devuelve el Markdown para incrustar imágenes en descripciones, comentarios o documentos.`,
    access: "write",
    annotations: WRITE,
    input: z.object({
      entity,
      fileName: z.string().min(1).max(180),
      contentBase64: z.string().min(1).max(Math.ceil((MAX_UPLOAD_BYTES * 4) / 3) + 4),
      purpose: z.enum(["file", "image"]).default("file").describe("image: para incrustar en Markdown."),
    }),
    target: (args) => ({ type: args.entity.kind, id: args.entity.id }),
    run: async ({ entity: target, fileName, contentBase64, purpose }) => {
      const bytes = Buffer.from(contentBase64, "base64");
      if (!bytes.length || bytes.length > MAX_UPLOAD_BYTES)
        throw new DomainError(`El archivo debe tener entre 1 byte y ${MAX_UPLOAD_BYTES / 1_000_000} MB.`, 413);
      const { scope } = await resolveEntity(ctx, target.kind, target.id);
      const manager = new FileManager(ctx.repo);
      const upload = await manager.begin(ctx.actor, {
        projectId: scope.projectId,
        scope,
        name: fileName,
        size: bytes.length,
        purpose,
      });
      try {
        if (upload.url) {
          const response = await fetch(upload.url, {
            method: "PUT",
            headers: { "Content-Type": upload.mimeType },
            body: new Uint8Array(bytes),
          });
          if (!response.ok) throw new DomainError("No se pudo subir el archivo al almacenamiento.", 502);
        } else
          await manager.put(
            ctx.actor,
            upload.id,
            new Request("http://taskode.internal/upload", {
              method: "PUT",
              headers: { "Content-Length": String(bytes.length) },
              body: new Uint8Array(bytes),
            }),
          );
        const file = await manager.complete(ctx.actor, upload.id, scope);
        const markdown =
          purpose === "image" ? `![${file.name.replace(/[\[\]]/g, "")}](${fileUrl(file.id)})` : `[${file.name.replace(/[\[\]]/g, "")}](${fileUrl(file.id)})`;
        return textResult(`Archivo adjuntado (id: \`${file.id}\`). Markdown: \`${markdown}\``, { id: file.id, markdown });
      } catch (error) {
        await manager.remove(ctx.actor, upload.id).catch(() => {});
        throw error;
      }
    },
  });
}
