import type { McpServer } from "@modelcontextprotocol/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { REMINDER_OFFSETS } from "../../../lib/notifications";
import { runCommand } from "../../commands";
import { DomainError } from "../../repository";
import * as schema from "../../schema";
import type { McpContext } from "../context";
import { defineTool } from "../define";
import { entityUrl, loadWorkspace, resolveEntity } from "../domain";
import { inline, textResult } from "../format";
import { color, entity, entityKind, id, ids, textMode, time } from "../schemas";

const WRITE = { readOnlyHint: false, destructiveHint: false } as const;
const IDEMPOTENT = { ...WRITE, idempotentHint: true } as const;
type Raw = {
  name?: string;
  title?: string;
  description?: string;
  icon?: string;
  color?: string;
  moduleId?: string | null;
  leaderId?: string;
  teamMemberIds?: string[];
  clientIds: string[];
  ticketIds: string[];
};
const OPTION_COMMAND = {
  status: "status",
  priority: "priority",
  task_type: "taskType",
  impact: "impact",
  label: "label",
} as const;

export function registerStructureTools(server: McpServer, ctx: McpContext) {
  const run = (command: Record<string, unknown>) => runCommand(ctx.repo, command, ctx.actor, ctx.effects);
  const current = async (kind: z.infer<typeof entityKind>, entityId: string) => {
    const detail = await ctx.repo.entityDetail(ctx.actor, kind, entityId);
    return { scope: detail.scope, raw: detail.entity as unknown as Raw };
  };

  defineTool(server, ctx, {
    name: "create_entity",
    title: "Crear proyecto, módulo o feature",
    description:
      "Crea un proyecto (quedas como líder), un módulo dentro de un proyecto o una feature (opcionalmente dentro de un módulo). Las tareas se crean con create_task.",
    access: "write",
    annotations: WRITE,
    input: z.object({
      kind: z.enum(["project", "module", "feature"]),
      projectId: id.optional().describe("Obligatorio para módulos y features."),
      moduleId: id.optional().describe("Solo features: módulo contenedor."),
      name: z.string().min(1).max(160),
      description: z.string().max(30000).default(""),
      icon: z.string().min(1).max(32).default("📁").describe("Solo proyectos: emoji."),
      color: color.default("#059669").describe("Solo proyectos."),
    }),
    target: (args) => ({ type: args.kind, id: args.projectId }),
    run: async ({ kind, projectId, moduleId, name, description, icon, color: tint }) => {
      if (kind !== "project" && !projectId) throw new DomainError("Indica el proyecto.");
      const { createdId } =
        kind === "project"
          ? await run({ type: "project.create", name, description, icon, color: tint })
          : kind === "module"
            ? await run({ type: "module.create", projectId, name, description })
            : await run({ type: "feature.create", projectId, name, description, moduleId: moduleId ?? null });
      const project = kind === "project" ? createdId! : projectId!;
      return textResult(`Creado (id: \`${createdId}\`): ${entityUrl(ctx, project, kind, createdId!)}`, { id: createdId ?? null });
    },
  });

  defineTool(server, ctx, {
    name: "update_entity",
    title: "Actualizar proyecto, módulo o feature",
    description:
      "Modifica nombre, descripción (reemplazar o añadir), icono y color (proyectos), zona horaria (proyectos), módulo contenedor o fijado (features). Solo cambia lo indicado.",
    access: "write",
    annotations: IDEMPOTENT,
    input: z.object({
      entity: z.object({ kind: z.enum(["project", "module", "feature"]), id }),
      name: z.string().min(1).max(160).optional(),
      description: z.string().max(30000).optional(),
      descriptionMode: textMode,
      icon: z.string().min(1).max(32).optional(),
      color: color.optional(),
      timeZone: z.string().max(100).optional().describe("Solo proyectos: zona IANA, p. ej. America/Bogota."),
      moduleId: id.nullable().optional().describe("Solo features: null la saca de su módulo."),
      pinned: z.boolean().optional().describe("Solo features (máximo 5 fijadas por proyecto)."),
    }),
    target: (args) => ({ type: args.entity.kind, id: args.entity.id }),
    run: async ({ entity: target, name, description, descriptionMode, icon, color: tint, timeZone, moduleId, pinned }) => {
      const { raw } = await current(target.kind, target.id);
      const content =
        description === undefined
          ? raw.description ?? ""
          : descriptionMode === "append" && raw.description
            ? `${raw.description}\n\n${description}`
            : description;
      const needsUpdate =
        description !== undefined ||
        (target.kind === "project" && (icon !== undefined || tint !== undefined)) ||
        (target.kind === "feature" && moduleId !== undefined);
      const changes: string[] = [];
      if (needsUpdate) {
        const fields = { id: target.id, name: name ?? raw.name, description: content };
        await run(
          target.kind === "project"
            ? { type: "project.update", ...fields, icon: icon ?? raw.icon, color: tint ?? raw.color }
            : target.kind === "module"
              ? { type: "module.update", ...fields }
              : { type: "feature.update", ...fields, moduleId: moduleId === undefined ? raw.moduleId ?? null : moduleId },
        );
        changes.push("datos");
      } else if (name !== undefined) {
        await run({ type: `${target.kind}.rename`, id: target.id, name });
        changes.push("nombre");
      }
      if (timeZone !== undefined) {
        if (target.kind !== "project") throw new DomainError("La zona horaria es del proyecto.");
        await run({ type: "project.timezone.update", id: target.id, timeZone });
        changes.push("zona horaria");
      }
      if (pinned !== undefined) {
        if (target.kind !== "feature") throw new DomainError("Solo las features se pueden fijar.");
        await run({ type: "feature.pin", id: target.id, pinned });
        changes.push(pinned ? "fijada" : "desfijada");
      }
      if (!changes.length) throw new DomainError("Indica al menos un cambio.");
      return `Actualizado: ${changes.join(", ")}.`;
    },
  });

  defineTool(server, ctx, {
    name: "set_assignment",
    title: "Asignar líder y equipo",
    description:
      "Cambia el líder y/o el equipo de un proyecto, módulo, feature o tarea. Puedes reemplazar el equipo o añadir/quitar personas. Las personas deben tener acceso al proyecto (ver get_project_tree).",
    access: "write",
    annotations: IDEMPOTENT,
    input: z.object({
      entity,
      leaderId: id.optional(),
      teamMemberIds: ids.optional().describe("Reemplaza el equipo completo."),
      addMemberIds: ids.optional(),
      removeMemberIds: ids.optional(),
    }),
    target: (args) => ({ type: args.entity.kind, id: args.entity.id }),
    run: async ({ entity: target, leaderId, teamMemberIds, addMemberIds, removeMemberIds }) => {
      const { raw } = await current(target.kind, target.id);
      const leader = leaderId ?? raw.leaderId;
      if (!leader) throw new DomainError("Indica el líder.");
      let team = teamMemberIds ?? raw.teamMemberIds ?? [];
      if (addMemberIds) team = [...new Set([...team, ...addMemberIds])];
      if (removeMemberIds) team = team.filter((member) => !removeMemberIds.includes(member));
      await run({
        type: `${target.kind}.assignment.update`,
        id: target.id,
        leaderId: leader,
        teamMemberIds: team.filter((member) => member !== leader),
      });
      return `Asignación guardada: líder \`${leader}\`, equipo de ${team.filter((member) => member !== leader).length} personas.`;
    },
  });

  defineTool(server, ctx, {
    name: "set_links",
    title: "Vincular clientes y tickets",
    description:
      "Vincula o desvincula clientes y tickets de un proyecto, módulo, feature o tarea (busca sus ids con search_catalog).",
    access: "write",
    annotations: IDEMPOTENT,
    input: z.object({
      entity,
      clientIds: ids.optional(),
      ticketIds: ids.optional(),
      mode: z.enum(["replace", "add", "remove"]).default("add"),
    }),
    target: (args) => ({ type: args.entity.kind, id: args.entity.id }),
    run: async ({ entity: target, clientIds, ticketIds, mode }) => {
      const { scope, raw } = await current(target.kind, target.id);
      const apply = (existing: string[], next: string[]) =>
        mode === "replace"
          ? next
          : mode === "add"
            ? [...new Set([...existing, ...next])]
            : existing.filter((value) => !next.includes(value));
      if (!clientIds && !ticketIds) throw new DomainError("Indica clientes o tickets.");
      if (clientIds) await run({ type: "entity.clients.update", scope, clientIds: apply(raw.clientIds, clientIds) });
      if (ticketIds) await run({ type: "entity.tickets.update", scope, ticketIds: apply(raw.ticketIds, ticketIds) });
      return "Vínculos actualizados.";
    },
  });

  defineTool(server, ctx, {
    name: "reorder",
    title: "Reordenar módulos, features o estados",
    description: "Cambia el orden de los módulos, las features o las columnas (estados) de un proyecto. Envía todos los ids en el nuevo orden.",
    access: "write",
    annotations: IDEMPOTENT,
    input: z.object({ kind: z.enum(["module", "feature", "status"]), projectId: id, orderedIds: z.array(id).min(1).max(10000) }),
    target: (args) => ({ type: args.kind, id: args.projectId }),
    run: async ({ kind, projectId, orderedIds }) => {
      await run({ type: `${kind}.reorder`, projectId, ids: orderedIds });
      return "Orden guardado.";
    },
  });

  defineTool(server, ctx, {
    name: "upsert_project_option",
    title: "Crear o editar estado, prioridad, tipo, impacto o etiqueta",
    description:
      "Crea (sin optionId) o modifica (con optionId) una opción del proyecto: estado/columna (isDone indica si cuenta como terminada), prioridad, tipo de tarea, impacto o etiqueta.",
    access: "write",
    annotations: WRITE,
    input: z.object({
      catalog: z.enum(["status", "priority", "task_type", "impact", "label"]),
      projectId: id,
      optionId: id.optional(),
      name: z.string().min(1).max(60).optional(),
      color: color.optional(),
      isDone: z.boolean().optional().describe("Solo estados."),
    }),
    target: (args) => ({ type: args.catalog, id: args.optionId ?? args.projectId }),
    run: async ({ catalog, projectId, optionId, name, color: tint, isDone }) => {
      const workspace = await loadWorkspace(ctx, [projectId]);
      const options = {
        status: workspace.statuses,
        priority: workspace.priorities,
        task_type: workspace.taskTypes,
        impact: workspace.impacts,
        label: workspace.labels,
      }[catalog];
      const existing = optionId ? options.find((option) => option.id === optionId) : undefined;
      if (optionId && !existing) throw new DomainError("La opción no existe en este proyecto.", 404);
      const finalName = name ?? existing?.name;
      if (!finalName) throw new DomainError("Escribe un nombre.");
      const finalColor = tint ?? existing?.color ?? "#64748b";
      const prefix = OPTION_COMMAND[catalog];
      const { createdId } =
        catalog === "status"
          ? existing
            ? await run({ type: "status.update", id: optionId, name: finalName, color: finalColor, isDone: isDone ?? Boolean((existing as unknown as { isDone?: boolean }).isDone) })
            : await run({ type: "status.create", projectId, name: finalName, color: finalColor, isDone: isDone ?? false })
          : await run({
              type: `${prefix}.${existing ? "update" : "create"}`,
              projectId,
              ...(existing ? { id: optionId } : {}),
              name: finalName,
              color: finalColor,
            });
      return textResult(`${existing ? "Actualizado" : "Creado"}: ${inline(finalName)} (id: \`${createdId ?? optionId}\`).`, {
        id: createdId ?? optionId ?? null,
      });
    },
  });

  defineTool(server, ctx, {
    name: "upsert_client",
    title: "Crear o editar cliente",
    description: "Crea (sin clientId) o modifica un cliente del catálogo global. La ciudad se busca con search_catalog catalog=cities.",
    access: "write",
    annotations: WRITE,
    input: z.object({ clientId: id.optional(), name: z.string().min(1).max(160).optional(), cityId: id.optional() }),
    target: (args) => ({ type: "client", id: args.clientId }),
    run: async ({ clientId, name, cityId }) => {
      if (!clientId) {
        if (!name || !cityId) throw new DomainError("Indica nombre y ciudad.");
        const { createdId } = await run({ type: "client.create", name, cityId });
        return textResult(`Cliente creado (id: \`${createdId}\`).`, { id: createdId ?? null });
      }
      const [existing] = await ctx.repo.store.db.select().from(schema.clients).where(eq(schema.clients.id, clientId));
      if (!existing) throw new DomainError("El cliente no existe.", 404);
      await run({ type: "client.update", id: clientId, name: name ?? existing.name, cityId: cityId ?? existing.cityId });
      return textResult("Cliente actualizado.", { id: clientId });
    },
  });

  defineTool(server, ctx, {
    name: "upsert_ticket",
    title: "Crear o editar ticket",
    description:
      "Crea (sin ticketId) o modifica un ticket del catálogo global: número, descripción, enlace y cliente. Al crearlo puede vincularse directamente a un elemento.",
    access: "write",
    annotations: WRITE,
    input: z.object({
      ticketId: id.optional(),
      number: z.string().min(1).max(100).optional(),
      description: z.string().max(30000).optional(),
      url: z.string().max(2048).nullable().optional(),
      clientId: id.nullable().optional(),
      linkTo: entity.optional().describe("Solo al crear: elemento al que se vincula."),
    }),
    target: (args) => ({ type: "ticket", id: args.ticketId }),
    run: async ({ ticketId, number, description, url, clientId, linkTo }) => {
      if (!ticketId) {
        if (!number) throw new DomainError("Escribe el número del ticket.");
        const scope = linkTo ? (await resolveEntity(ctx, linkTo.kind, linkTo.id)).scope : undefined;
        const { createdId } = await run({
          type: "ticket.create",
          number,
          description: description ?? "",
          url: url ?? null,
          clientId: clientId ?? null,
          ...(scope ? { scope } : {}),
        });
        return textResult(`Ticket creado (id: \`${createdId}\`).`, { id: createdId ?? null });
      }
      const [existing] = await ctx.repo.store.db.select().from(schema.tickets).where(eq(schema.tickets.id, ticketId));
      if (!existing) throw new DomainError("El ticket no existe.", 404);
      await run({
        type: "ticket.update",
        id: ticketId,
        number: number ?? existing.number,
        description: description ?? existing.description,
        url: url === undefined ? existing.url : url,
        clientId: clientId === undefined ? existing.clientId : clientId,
      });
      return textResult("Ticket actualizado.", { id: ticketId });
    },
  });

  defineTool(server, ctx, {
    name: "mark_notifications_read",
    title: "Marcar avisos",
    description: "Marca un aviso como leído o no leído, o todos tus avisos como leídos (all=true).",
    access: "write",
    annotations: IDEMPOTENT,
    input: z.object({ notificationId: id.optional(), read: z.boolean().default(true), all: z.boolean().default(false) }),
    target: (args) => ({ type: "notification", id: args.notificationId }),
    run: async ({ notificationId, read, all }) => {
      if (notificationId) await ctx.repo.notifications.read(ctx.actor, { id: notificationId, read });
      else if (all) {
        const { through } = await ctx.repo.notifications.list(ctx.actor, { filter: "all", limit: 1 });
        if (through) await ctx.repo.notifications.read(ctx.actor, { through });
      } else throw new DomainError("Indica notificationId o all=true.");
      ctx.effects.notifications();
      return "Avisos actualizados.";
    },
  });

  defineTool(server, ctx, {
    name: "update_notification_preferences",
    title: "Preferencias de recordatorios",
    description: `Configura con cuánta anticipación (minutos: ${REMINDER_OFFSETS.join(", ")}; máximo 3) recibes recordatorios de vencimiento y a qué hora para tareas sin hora.`,
    access: "write",
    annotations: IDEMPOTENT,
    input: z.object({
      offsets: z.array(z.number().int()).max(3).optional(),
      dateOnlyTime: time.optional(),
    }),
    run: async ({ offsets, dateOnlyTime }) => {
      const currentPreferences = await ctx.repo.notifications.preferences(ctx.actor);
      const saved = await ctx.repo.notifications.savePreferences(ctx.actor, {
        offsets: offsets ?? currentPreferences.offsets,
        dateOnlyTime: dateOnlyTime ?? currentPreferences.dateOnlyTime,
      });
      return textResult("Preferencias guardadas.", { preferences: saved as unknown as Record<string, unknown> });
    },
  });
}
