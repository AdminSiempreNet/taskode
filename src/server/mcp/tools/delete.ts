import type { McpServer } from "@modelcontextprotocol/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { runCommand } from "../../commands";
import { DiagramsService } from "../../diagrams";
import { DocumentsService } from "../../documents";
import { FileManager } from "../../files";
import { DomainError } from "../../repository";
import * as schema from "../../schema";
import type { McpContext } from "../context";
import { defineTool } from "../define";
import { loadWorkspace } from "../domain";
import { inline } from "../format";
import { confirm, id } from "../schemas";

const TYPES = [
  "project",
  "module",
  "feature",
  "task",
  "comment",
  "document",
  "diagram",
  "file",
  "checklist",
  "checklist_item",
  "status",
  "priority",
  "task_type",
  "impact",
  "label",
  "client",
  "ticket",
] as const;
type DeletableType = (typeof TYPES)[number];
const OPTION_PREFIX = { priority: "priority", task_type: "taskType", impact: "impact", label: "label" } as const;
const normalize = (value: string) => value.normalize("NFC").trim().replace(/\s+/g, " ");
const first = <T>(rows: T[]) => {
  if (!rows[0]) throw new DomainError("El elemento no existe o no tienes acceso.", 404);
  return rows[0];
};

export function registerDeleteTool(server: McpServer, ctx: McpContext) {
  const run = (command: Record<string, unknown>) => runCommand(ctx.repo, command, ctx.actor, ctx.effects);
  const db = () => ctx.repo.store.db;
  // Resolves the human name of the target through the same access checks as the UI, and the
  // operation that deletes it. Nothing is deleted until the confirmation matches.
  async function plan(type: DeletableType, targetId: string, projectId?: string) {
    switch (type) {
      case "project":
      case "module":
      case "feature": {
        const detail = await ctx.repo.entityDetail(ctx.actor, type, targetId);
        const name = String((detail.entity as unknown as { name: string }).name);
        return { name, remove: () => run({ type: `${type}.delete`, id: targetId }) };
      }
      case "task": {
        const { task } = await ctx.repo.requireTask(ctx.actor, targetId);
        return { name: String(task.title), remove: () => run({ type: "task.delete", id: targetId }) };
      }
      case "comment": {
        first(await db().select({ id: schema.comments.id }).from(schema.comments).where(eq(schema.comments.id, targetId)));
        return { name: targetId, remove: () => run({ type: "comment.delete", id: targetId }) };
      }
      case "document": {
        const documents = new DocumentsService(ctx.repo);
        const doc = await documents.get(ctx.actor, targetId);
        return {
          name: doc.title,
          remove: async () => {
            await documents.remove(ctx.actor, targetId);
            ctx.effects.notifications();
          },
        };
      }
      case "diagram": {
        const diagrams = new DiagramsService(ctx.repo);
        const diagram = await diagrams.get(ctx.actor, targetId);
        return { name: diagram.title, remove: () => diagrams.remove(ctx.actor, targetId) };
      }
      case "file": {
        const files = new FileManager(ctx.repo);
        const file = await files.read(ctx.actor, targetId, 0);
        return { name: file.name, remove: () => files.remove(ctx.actor, targetId) };
      }
      case "checklist": {
        const list = first(await db().select().from(schema.checklists).where(eq(schema.checklists.id, targetId)));
        await ctx.repo.requireTask(ctx.actor, list.taskId);
        return { name: list.title, remove: () => run({ type: "checklist.delete", id: targetId }) };
      }
      case "checklist_item": {
        const item = first(await db().select().from(schema.checklistItems).where(eq(schema.checklistItems.id, targetId)));
        const list = first(await db().select().from(schema.checklists).where(eq(schema.checklists.id, item.checklistId)));
        await ctx.repo.requireTask(ctx.actor, list.taskId);
        return { name: item.title, remove: () => run({ type: "checklist.item.delete", id: targetId }) };
      }
      case "client": {
        const client = first(await db().select().from(schema.clients).where(eq(schema.clients.id, targetId)));
        return { name: client.name, remove: () => run({ type: "client.delete", id: targetId }) };
      }
      case "ticket": {
        const ticket = first(await db().select().from(schema.tickets).where(eq(schema.tickets.id, targetId)));
        return { name: ticket.number, remove: () => run({ type: "ticket.delete", id: targetId }) };
      }
      default: {
        if (!projectId) throw new DomainError("Indica projectId para eliminar opciones del proyecto.");
        await ctx.repo.requireProject(ctx.actor, projectId);
        const workspace = await loadWorkspace(ctx, [projectId]);
        const options =
          type === "status"
            ? workspace.statuses
            : type === "priority"
              ? workspace.priorities
              : type === "task_type"
                ? workspace.taskTypes
                : type === "impact"
                  ? workspace.impacts
                  : workspace.labels;
        const option = first(options.filter((candidate) => candidate.id === targetId));
        return {
          name: option.name,
          remove: () =>
            type === "status"
              ? run({ type: "status.delete", id: targetId })
              : run({ type: `${OPTION_PREFIX[type]}.delete`, projectId, id: targetId }),
        };
      }
    }
  }

  defineTool(server, ctx, {
    name: "delete_item",
    title: "Eliminar",
    description:
      "Elimina definitivamente un elemento (proyecto, módulo, feature, tarea, comentario, documento, diagrama, archivo, checklist, ítem, opción del proyecto, cliente o ticket). Es irreversible: confirma antes con la persona y pasa en confirm el nombre, título o número exacto del elemento (para comentarios, su id). Para conservar una tarea usa archive_task.",
    access: "write",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    input: z.object({
      type: z.enum(TYPES),
      id,
      projectId: id.optional().describe("Obligatorio para status, priority, task_type, impact y label."),
      confirm,
    }),
    target: (args) => ({ type: args.type, id: args.id }),
    run: async ({ type, id: targetId, projectId, confirm: confirmation }) => {
      const target = await plan(type, targetId, projectId);
      if (normalize(confirmation) !== normalize(target.name))
        throw new DomainError(
          "La confirmación no coincide con el elemento. No se eliminó nada: pide a la persona que confirme y escribe el nombre exacto.",
        );
      await target.remove();
      return `Eliminado: ${inline(target.name)}.`;
    },
  });
}
