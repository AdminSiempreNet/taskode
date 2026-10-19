import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { commandSchema } from "../../../lib/validation";
import { deliverCommandEffects, runCommand } from "../../commands";
import { DomainError } from "../../repository";
import type { McpContext } from "../context";
import { defineTool } from "../define";
import { loadTask, loadWorkspace, resolveEntity, taskMarkdown, taskUrl } from "../domain";
import { inline, textResult } from "../format";
import { date, entity, id, ids, textMode, time } from "../schemas";

const WRITE = { readOnlyHint: false, destructiveHint: false } as const;
const IDEMPOTENT = { ...WRITE, idempotentHint: true } as const;
const merge = (current: string, next: string | undefined, mode: "replace" | "append") =>
  next === undefined ? current : mode === "append" && current ? `${current}\n\n${next}` : next;

export function registerTaskTools(server: McpServer, ctx: McpContext) {
  const run = (command: Record<string, unknown>) => runCommand(ctx.repo, command, ctx.actor, ctx.effects);

  defineTool(server, ctx, {
    name: "create_task",
    title: "Crear tarea",
    description:
      "Crea una tarea en una feature. Sin statusId va a la primera columna; sin priority usa la prioridad media. Las etiquetas se indican por nombre y se crean si no existen. Puede incluir un checklist inicial.",
    access: "write",
    annotations: WRITE,
    input: z.object({
      projectId: id,
      featureId: id,
      title: z.string().min(1).max(300),
      description: z.string().max(30000).default("").describe("Markdown."),
      statusId: id.optional(),
      priority: id.optional().describe("Id de prioridad (por defecto: low, medium, high)."),
      typeId: id.optional(),
      impactId: id.optional(),
      startDate: date.optional(),
      startTime: time.optional(),
      dueDate: date.optional(),
      dueTime: time.optional(),
      labels: z.array(z.string().min(1).max(60)).max(20).default([]),
      leaderId: id.optional().describe("Responsable principal (por defecto tú)."),
      teamMemberIds: ids.optional(),
      applicationIds: ids.optional().describe("Aplicaciones del proyecto; omisión al crear asigna la predeterminada; [] deja sin aplicación."),
      clientIds: ids.optional(),
      ticketIds: ids.optional(),
      checklist: z
        .object({ title: z.string().min(1).max(160).default("Checklist"), items: z.array(z.string().min(1).max(300)).max(100) })
        .optional(),
    }),
    target: (args) => ({ type: "task", id: args.featureId }),
    run: async ({ checklist, statusId, priority, dueDate, ...input }) => {
      const workspace = await loadWorkspace(ctx, [input.projectId]);
      const status = statusId ?? workspace.statuses[0]?.id;
      if (!status) throw new DomainError("El proyecto no tiene estados.", 409);
      const chosenPriority =
        priority ?? (workspace.priorities.find((option) => option.id === "medium") ?? workspace.priorities[0])?.id;
      if (!chosenPriority) throw new DomainError("El proyecto no tiene prioridades.", 409);
      const taskId = await ctx.repo.store.transaction(async () => {
        const { createdId } = await run({
          type: "task.create",
          ...input,
          statusId: status,
          priority: chosenPriority,
          dueDate: dueDate ?? null,
        });
        if (checklist) {
          const list = await run({ type: "checklist.create", taskId: createdId, title: checklist.title });
          for (const title of checklist.items)
            await run({ type: "checklist.item.create", checklistId: list.createdId, title });
        }
        return createdId!;
      });
      const { task, workspace: fresh } = await loadTask(ctx, taskId);
      return textResult(`Tarea creada: ${taskUrl(ctx, task)}\n\n${taskMarkdown(ctx, fresh, task, { comments: false })}`, {
        taskId,
      });
    },
  });

  defineTool(server, ctx, {
    name: "update_task",
    title: "Actualizar tarea",
    description:
      "Modifica solo los campos indicados de una tarea (el resto se conserva). Para cambiar de columna usa move_task. Usa null para vaciar fechas, tipo o impacto. Con expectedUpdatedAt evita pisar cambios de otra persona.",
    access: "write",
    annotations: IDEMPOTENT,
    input: z.object({
      taskId: id,
      title: z.string().min(1).max(300).optional(),
      description: z.string().max(30000).optional().describe("Markdown."),
      descriptionMode: textMode,
      featureId: id.optional(),
      statusId: id.optional(),
      priority: id.optional(),
      typeId: id.nullable().optional(),
      impactId: id.nullable().optional(),
      startDate: date.nullable().optional(),
      startTime: time.nullable().optional(),
      dueDate: date.nullable().optional(),
      dueTime: time.nullable().optional(),
      labels: z.array(z.string().min(1).max(60)).max(20).optional().describe("Reemplaza todas las etiquetas."),
      addLabels: z.array(z.string().min(1).max(60)).max(20).optional(),
      removeLabels: z.array(z.string().min(1).max(60)).max(20).optional(),
      applicationIds: ids.optional().describe("Aplicaciones del proyecto; omisión al crear asigna la predeterminada; [] deja sin aplicación."),
      clientIds: ids.optional().describe("Reemplaza los clientes vinculados."),
      expectedUpdatedAt: z.string().optional().describe("updatedAt leído con get_task; si cambió, no se guarda."),
    }),
    target: (args) => ({ type: "task", id: args.taskId }),
    run: async ({ taskId, descriptionMode, expectedUpdatedAt, addLabels, removeLabels, ...patch }) => {
      const { task } = await loadTask(ctx, taskId);
      if (expectedUpdatedAt && expectedUpdatedAt !== task.updatedAt)
        throw new DomainError("La tarea cambió desde que la leíste.", 409);
      const fields = Object.entries(patch).filter(([, value]) => value !== undefined).map(([key]) => key);
      if (!fields.length && !addLabels?.length && !removeLabels?.length)
        throw new DomainError("Indica al menos un campo para modificar.");
      if (fields.length === 1 && fields[0] === "title" && !addLabels && !removeLabels)
        await run({ type: "task.rename", id: taskId, title: patch.title });
      else {
        let labels = patch.labels ?? task.labels;
        if (addLabels) labels = [...new Set([...labels, ...addLabels])];
        if (removeLabels) labels = labels.filter((label) => !removeLabels.includes(label));
        await run({
          type: "task.update",
          id: taskId,
          title: patch.title ?? task.title,
          description: merge(task.description, patch.description, descriptionMode),
          featureId: patch.featureId ?? task.featureId,
          statusId: patch.statusId ?? task.statusId,
          priority: patch.priority ?? task.priority,
          typeId: patch.typeId === undefined ? task.typeId : patch.typeId,
          impactId: patch.impactId === undefined ? task.impactId : patch.impactId,
          startDate: patch.startDate === undefined ? task.startDate : patch.startDate,
          startTime: patch.startTime === undefined ? task.startTime : patch.startTime,
          dueDate: patch.dueDate === undefined ? task.dueDate : patch.dueDate,
          dueTime: patch.dueTime === undefined ? task.dueTime : patch.dueTime,
          labels,
          clientIds: patch.clientIds ?? task.clientIds,
          applicationIds: patch.applicationIds,
        });
      }
      const fresh = await loadTask(ctx, taskId);
      return textResult(`Tarea actualizada.\n\n${taskMarkdown(ctx, fresh.workspace, fresh.task, { comments: false })}`, {
        taskId,
        updatedAt: fresh.task.updatedAt,
      });
    },
  });

  defineTool(server, ctx, {
    name: "move_task",
    title: "Mover tarea de columna",
    description:
      "Cambia el estado (columna) de una tarea y su posición. Sin beforeTaskId queda al final de la columna. Queda registrado en el historial de estados.",
    access: "write",
    annotations: IDEMPOTENT,
    input: z.object({
      taskId: id,
      statusId: id,
      beforeTaskId: id.nullable().optional().describe("Colocar antes de esta tarea de la misma columna."),
    }),
    target: (args) => ({ type: "task", id: args.taskId }),
    run: async ({ taskId, statusId, beforeTaskId }) => {
      await run({ type: "task.move", id: taskId, statusId, beforeId: beforeTaskId ?? null });
      const { task, workspace } = await loadTask(ctx, taskId);
      const status = workspace.statuses.find((candidate) => candidate.id === task.statusId);
      return `«${inline(task.title)}» ahora está en ${inline(status?.name ?? statusId)}. ${taskUrl(ctx, task)}`;
    },
  });

  defineTool(server, ctx, {
    name: "archive_task",
    title: "Archivar o restaurar tarea",
    description: "Archiva una tarea (deja de verse en el tablero, se conserva) o la restaura.",
    access: "write",
    annotations: IDEMPOTENT,
    input: z.object({ taskId: id, archived: z.boolean().default(true) }),
    target: (args) => ({ type: "task", id: args.taskId }),
    run: async ({ taskId, archived }) => {
      await run({ type: "task.archive", id: taskId, archived });
      return archived ? "Tarea archivada." : "Tarea restaurada.";
    },
  });

  defineTool(server, ctx, {
    name: "upsert_checklist",
    title: "Editar checklist",
    description:
      "Crea o modifica el checklist de una tarea (una por tarea): título, nuevos ítems y cambios de ítems existentes (título o completado). Usa los ids de ítems de get_task.",
    access: "write",
    annotations: WRITE,
    input: z.object({
      taskId: id,
      title: z.string().min(1).max(160).optional(),
      addItems: z.array(z.string().min(1).max(300)).max(100).default([]),
      updateItems: z
        .array(z.object({ itemId: id, title: z.string().min(1).max(300).optional(), completed: z.boolean().optional() }))
        .max(200)
        .default([]),
    }),
    target: (args) => ({ type: "task", id: args.taskId }),
    run: async ({ taskId, title, addItems, updateItems }) => {
      const { task } = await loadTask(ctx, taskId);
      await ctx.repo.store.transaction(async () => {
        const checklist = task.checklists[0];
        let checklistId: string | undefined = checklist?.id;
        if (!checklist)
          checklistId = (await run({ type: "checklist.create", taskId, title: title ?? "Checklist" })).createdId;
        else if (title && title !== checklist.title) await run({ type: "checklist.update", id: checklist.id, title });
        for (const item of addItems) await run({ type: "checklist.item.create", checklistId, title: item });
        for (const change of updateItems) {
          const current = checklist?.items.find((item) => item.id === change.itemId);
          if (!current) throw new DomainError("El ítem no pertenece al checklist de esta tarea.", 404);
          await run({
            type: "checklist.item.update",
            id: change.itemId,
            title: change.title ?? current.title,
            completed: change.completed ?? current.completed,
          });
        }
      });
      const fresh = await loadTask(ctx, taskId);
      const list = fresh.task.checklists[0];
      return textResult(
        list
          ? `${inline(list.title)} (${list.items.filter((item) => item.completed).length}/${list.items.length})\n${list.items
              .map((item) => `- [${item.completed ? "x" : " "}] ${inline(item.title)} (id: \`${item.id}\`)`)
              .join("\n")}`
          : "Sin checklist.",
        { checklist: list ?? null },
      );
    },
  });

  defineTool(server, ctx, {
    name: "add_comment",
    title: "Comentar",
    description:
      "Publica un comentario en Markdown en un proyecto, módulo, feature o tarea. Para mencionar usa el Markdown de get_mention_options (la persona recibe un aviso). requestId evita duplicados si repites la llamada.",
    access: "write",
    annotations: WRITE,
    input: z.object({
      entity,
      content: z.string().min(1).max(10000),
      requestId: z.uuid().optional(),
    }),
    target: (args) => ({ type: args.entity.kind, id: args.entity.id }),
    run: async ({ entity: target, content, requestId }) => {
      const { scope } = await resolveEntity(ctx, target.kind, target.id);
      const command = commandSchema.parse({
        type: "comment.create",
        scope,
        content,
        requestId: requestId ?? randomUUID(),
      });
      const result = await ctx.repo.executeEntityComment(ctx.actor, target.kind, target.id, command);
      deliverCommandEffects(command.type, ctx.effects);
      return textResult(`Comentario publicado (id: \`${result.createdId}\`).`, { commentId: result.createdId ?? null });
    },
  });

  defineTool(server, ctx, {
    name: "edit_comment",
    title: "Editar comentario",
    description: "Reemplaza el texto de un comentario tuyo.",
    access: "write",
    annotations: IDEMPOTENT,
    input: z.object({ commentId: id, content: z.string().min(1).max(10000) }),
    target: (args) => ({ type: "comment", id: args.commentId }),
    run: async ({ commentId, content }) => {
      await run({ type: "comment.update", id: commentId, content });
      return "Comentario actualizado.";
    },
  });
}
