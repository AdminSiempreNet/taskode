import { entityPath, taskPath } from "../../lib/routes";
import { PRIORITIES, type EntityKind, type Task, type Workspace } from "../../lib/types";
import { DomainError } from "../repository";
import type { McpContext } from "./context";
import { inline, link, list, untrusted } from "./format";

export async function loadWorkspace(ctx: McpContext, projectIds?: string[], includeCatalogs = false) {
  return ctx.repo.getWorkspace(ctx.actor, { includeCatalogs, projectIds });
}
// Full task (checklist, comments, history, files) through the same visibility rules as the UI.
export async function loadTask(ctx: McpContext, taskId: string) {
  const { task: row } = await ctx.repo.requireTask(ctx.actor, taskId);
  const workspace = await loadWorkspace(ctx, [String(row.projectId)], true);
  const task = workspace.tasks.find((candidate) => candidate.id === taskId);
  if (!task) throw new DomainError("La tarea no existe o no tienes acceso.", 404);
  return { task, workspace };
}
export async function resolveEntity(ctx: McpContext, kind: EntityKind, id: string) {
  return ctx.repo.requireEntity(ctx.actor, kind, id);
}
export function lookups(workspace: Workspace) {
  const by = <T extends { id: string }>(items: T[]) => new Map(items.map((item) => [item.id, item]));
  const people = new Map<string, string>();
  for (const person of workspace.people ?? []) people.set(person.id, person.name);
  for (const task of workspace.tasks) {
    if (task.leader) people.set(task.leader.id, task.leader.name);
    for (const member of task.teamMembers ?? []) people.set(member.id, member.name);
  }
  people.set(workspace.currentUser.id, workspace.currentUser.name);
  return {
    projects: by(workspace.projects),
    modules: by(workspace.modules),
    features: by(workspace.features),
    statuses: by(workspace.statuses),
    priorities: by(workspace.priorities),
    taskTypes: by(workspace.taskTypes),
    impacts: by(workspace.impacts),
    clients: by(workspace.clients),
    tickets: by(workspace.tickets),
    person: (id: string | null | undefined) => (id ? inline(people.get(id) ?? id) : "—"),
  };
}
export type Lookups = ReturnType<typeof lookups>;
export function priorityName(names: Lookups, priority: string) {
  return inline(
    names.priorities.get(priority)?.name ?? PRIORITIES[priority as keyof typeof PRIORITIES] ?? priority,
  );
}
export function featureName(names: Lookups, featureId: string) {
  const feature = names.features.get(featureId);
  return feature ? `#${feature.number} ${inline(feature.name)}` : featureId;
}
export function taskUrl(ctx: McpContext, task: Pick<Task, "id" | "projectId">) {
  return link(ctx.origin, taskPath(task.projectId, task.id));
}
export function entityUrl(ctx: McpContext, projectId: string, kind: EntityKind, id: string) {
  return link(ctx.origin, entityPath(projectId, kind, id));
}
function dates(task: Task) {
  const due = task.dueDate ? `vence ${task.dueDate}${task.dueTime ? ` ${task.dueTime}` : ""}` : "";
  const start = task.startDate ? `inicia ${task.startDate}${task.startTime ? ` ${task.startTime}` : ""}` : "";
  return [start, due].filter(Boolean).join(", ");
}
// One line per task in listings. The title is inline user text; full content goes in get_task.
export function taskLine(ctx: McpContext, names: Lookups, task: Task) {
  const status = names.statuses.get(task.statusId);
  return [
    `- **${inline(task.title)}** (id: \`${task.id}\`)`,
    `${inline(status?.name ?? task.statusId)}${status?.isDone ? " ✓" : ""}`,
    `prioridad ${priorityName(names, task.priority)}`,
    dates(task),
    `líder ${names.person(task.leaderId)}`,
    featureName(names, task.featureId),
    task.archived ? "archivada" : "",
  ]
    .filter(Boolean)
    .join(" · ");
}
export function taskMarkdown(
  ctx: McpContext,
  workspace: Workspace,
  task: Task,
  include: { comments?: boolean; checklist?: boolean; history?: boolean; files?: boolean } = {},
) {
  const names = lookups(workspace);
  const feature = names.features.get(task.featureId);
  const module = feature?.moduleId ? names.modules.get(feature.moduleId) : undefined;
  const project = names.projects.get(task.projectId);
  const status = names.statuses.get(task.statusId);
  const sections = [
    `# Tarea: ${inline(task.title)}`,
    list([
      `- id: \`${task.id}\``,
      `- enlace: ${taskUrl(ctx, task)}`,
      `- proyecto: ${inline(project?.name ?? task.projectId)} (\`${task.projectId}\`)`,
      module && `- módulo: ${inline(module.name)} (\`${module.id}\`)`,
      `- feature: ${featureName(names, task.featureId)} (\`${task.featureId}\`)`,
      `- estado: ${inline(status?.name ?? task.statusId)} (\`${task.statusId}\`)${status?.isDone ? " — terminado" : ""}`,
      `- prioridad: ${priorityName(names, task.priority)} (\`${task.priority}\`)`,
      task.typeId && `- tipo: ${inline(names.taskTypes.get(task.typeId)?.name ?? task.typeId)} (\`${task.typeId}\`)`,
      task.impactId && `- impacto: ${inline(names.impacts.get(task.impactId)?.name ?? task.impactId)} (\`${task.impactId}\`)`,
      dates(task) && `- fechas: ${dates(task)}`,
      `- líder: ${names.person(task.leaderId)}${task.leaderId ? ` (\`${task.leaderId}\`)` : ""}`,
      task.teamMemberIds?.length &&
        `- equipo: ${task.teamMemberIds.map((id) => `${names.person(id)} (\`${id}\`)`).join(", ")}`,
      task.labels.length && `- etiquetas: ${task.labels.map(inline).join(", ")}`,
      task.clientIds.length &&
        `- clientes: ${task.clientIds.map((id) => `${inline(names.clients.get(id)?.name ?? id)} (\`${id}\`)`).join(", ")}`,
      task.ticketIds.length &&
        `- tickets: ${task.ticketIds.map((id) => `${inline(names.tickets.get(id)?.number ?? id)} (\`${id}\`)`).join(", ")}`,
      `- archivada: ${task.archived ? "sí" : "no"}`,
      `- creada: ${task.createdAt} · actualizada: ${task.updatedAt}`,
      task.permissions &&
        `- permisos: editar sí, gestionar acceso ${task.permissions.canManageAccess ? "sí" : "no"}, eliminar ${task.permissions.canDelete ? "sí" : "no"}`,
    ]),
    "## Descripción",
    task.description ? untrusted("descripcion", task.description, { tarea: task.id }) : "_Sin descripción._",
  ];
  if (include.checklist !== false) {
    const checklist = task.checklists[0];
    sections.push("## Checklist");
    sections.push(
      checklist
        ? list([
            `${inline(checklist.title)} (id: \`${checklist.id}\`) — ${checklist.items.filter((item) => item.completed).length}/${checklist.items.length}`,
            ...checklist.items.map(
              (item) => `- [${item.completed ? "x" : " "}] ${inline(item.title)} (id: \`${item.id}\`)`,
            ),
          ])
        : "_Sin checklist._",
    );
  }
  if (include.files !== false && task.files?.length)
    sections.push(
      "## Archivos",
      task.files
        .map((file) => `- ${inline(file.name)} · ${file.mimeType} · ${file.size} bytes (id: \`${file.id}\`)`)
        .join("\n"),
    );
  if (include.history && task.statusHistory.length)
    sections.push(
      "## Historial de estados",
      task.statusHistory
        .slice(0, 30)
        .map((change) => `- ${change.changedAt}: ${inline(change.fromStatusName)} → ${inline(change.toStatusName)}`)
        .join("\n"),
    );
  if (include.comments !== false) {
    const comments = task.comments.slice(-30);
    sections.push(`## Comentarios (${task.comments.length})`);
    sections.push(
      comments.length
        ? comments
            .map((comment) =>
              untrusted("comentario", comment.content, {
                id: comment.id,
                autor: comment.author?.name ?? "desconocido",
                fecha: comment.createdAt,
              }),
            )
            .join("\n")
        : "_Sin comentarios._",
    );
  }
  return sections.join("\n\n");
}
// Plain JSON for structuredContent: ids and fields an agent can feed back into other tools.
export function taskSummary(names: Lookups, task: Task) {
  return {
    id: task.id,
    projectId: task.projectId,
    featureId: task.featureId,
    title: task.title,
    statusId: task.statusId,
    status: names.statuses.get(task.statusId)?.name ?? null,
    done: names.statuses.get(task.statusId)?.isDone ?? false,
    priority: task.priority,
    dueDate: task.dueDate,
    dueTime: task.dueTime,
    startDate: task.startDate,
    leaderId: task.leaderId ?? null,
    teamMemberIds: task.teamMemberIds ?? [],
    labels: task.labels,
    archived: task.archived,
    updatedAt: task.updatedAt,
  };
}
