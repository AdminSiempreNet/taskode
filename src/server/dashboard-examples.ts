import { commandSchema } from "../lib/validation";
import { dashboardDate } from "../lib/dashboard";
import type { PostgresRepository } from "./postgres";

const marker = (key: string) => `<!-- taskode:example:dashboard:v1:${key} -->`;
const notice =
  "Datos de ejemplo para evaluar los dashboards. El avance y las fechas son simulados.";
const definitions = [
  {
    key: "portal",
    name: "Portal de clientes",
    icon: "🌐",
    color: "#3b82f6",
    memberLeads: false,
    modules: ["Experiencia del cliente", "Servicios y acceso"],
    features: [
      "Registro y perfil",
      "Solicitudes de soporte",
      "Facturación",
      "Acceso seguro",
      "Mejoras generales",
    ],
    tasks: [
      "Diseñar el formulario de registro",
      "Validar los datos del perfil",
      "Conectar el directorio de clientes",
      "Probar el acceso desde móvil",
      "Crear una solicitud de soporte",
      "Mostrar el seguimiento de solicitudes",
      "Añadir documentos a la solicitud",
      "Confirmar recepción al cliente",
      "Consultar las facturas del cliente",
      "Descargar el comprobante de pago",
      "Revisar los saldos pendientes",
      "Validar los datos tributarios",
      "Configurar los permisos del portal",
      "Revisar la expiración de sesiones",
      "Probar la recuperación de acceso",
      "Registrar los eventos de seguridad",
      "Revisar los textos de ayuda",
      "Mejorar el contraste de la navegación",
      "Documentar la entrega anterior",
      "Retirar el prototipo inicial",
    ],
  },
  {
    key: "operations",
    name: "Operaciones internas",
    icon: "⚙️",
    color: "#8b5cf6",
    memberLeads: true,
    modules: ["Coordinación operativa", "Control y seguimiento"],
    features: [
      "Planificación semanal",
      "Órdenes de trabajo",
      "Inventario",
      "Reportes operativos",
      "Mejoras generales",
    ],
    tasks: [
      "Preparar la planificación semanal",
      "Distribuir los turnos del equipo",
      "Confirmar las entregas de la semana",
      "Revisar la disponibilidad del equipo",
      "Registrar una orden de trabajo",
      "Asignar el equipo de atención",
      "Validar los materiales requeridos",
      "Confirmar el cierre de la orden",
      "Actualizar el catálogo de materiales",
      "Revisar los niveles de inventario",
      "Registrar una salida de materiales",
      "Conciliar las existencias del almacén",
      "Preparar el reporte de cumplimiento",
      "Revisar las órdenes pendientes",
      "Publicar el resumen del equipo",
      "Validar los indicadores de operación",
      "Documentar el proceso de entrega",
      "Actualizar la guía del equipo",
      "Archivar el reporte anterior",
      "Retirar el flujo experimental",
    ],
  },
] as const;

export function exampleReferenceDate(value?: string) {
  const day = value ?? dashboardDate(new Date()).day;
  const date = new Date(`${day}T12:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== day
  )
    throw new Error("La fecha de referencia no es válida.");
  return day;
}

export async function seedDashboardExamples(
  repo: PostgresRepository,
  options: { apply: boolean; date?: string },
) {
  const date = exampleReferenceDate(options.date);
  const dateAt = (offset: number) => {
    const value = new Date(`${date}T12:00:00Z`);
    value.setUTCDate(value.getUTCDate() + offset);
    return value.toISOString().slice(0, 10);
  };
  const work = async () => {
    const state = await repo.store.state();
    const users = await repo.store.db.query.user.findMany();
    const admin = users.find(
      (u) => u.id === state.adminId && u.role === "admin",
    );
    const members = users.filter((u) => u.role === "member");
    if (!admin || members.length !== 1)
      throw new Error(
        "La carga requiere el administrador de la instalación y exactamente un usuario miembro existente.",
      );
    const member = members[0];
    const actor = { id: admin.id };
    const run = async (input: unknown) =>
      (await repo.execute(commandSchema.parse(input), actor)).createdId!;
    const initial = await repo.getWorkspace(actor);
    const added = {
      projects: 0,
      modules: 0,
      features: 0,
      tasks: 0,
      checklists: 0,
    };
    const skipped = { projects: 0, modules: 0, features: 0, tasks: 0 };
    const find = <T extends { id: string; description: string }>(
      rows: T[],
      key: string,
    ) => {
      const matches = rows.filter((r) => r.description.includes(marker(key)));
      if (matches.length > 1)
        throw new Error(`Se encontraron ejemplos duplicados: ${key}.`);
      return matches[0];
    };
    const summary: { name: string; projectId: string; leaderId: string }[] = [];
    for (const definition of definitions) {
      const projectKey = `${definition.key}:project`;
      const previousProject = find(initial.projects, projectKey);
      const leaderId = definition.memberLeads ? member.id : admin.id;
      let projectId = previousProject?.id ?? `preview-${definition.key}`;
      let workspace = initial;
      if (previousProject) skipped.projects++;
      else {
        if (
          initial.projects.some(
            (p) =>
              p.name.toLocaleLowerCase("es") ===
              definition.name.toLocaleLowerCase("es"),
          )
        )
          throw new Error(
            `Ya existe un proyecto ajeno a esta carga: ${definition.name}.`,
          );
        added.projects++;
        if (options.apply) {
          projectId = await run({
            type: "project.create",
            name: definition.name,
            icon: definition.icon,
            color: definition.color,
            description: `${notice}\n\n${marker(projectKey)}`,
          });
          await run({
            type: "project.assignment.update",
            id: projectId,
            leaderId,
            teamMemberIds: [leaderId === admin.id ? member.id : admin.id],
          });
          workspace = await repo.getWorkspace(actor);
          const done = workspace.statuses.find(
            (s) => s.projectId === projectId && s.isDone,
          )!;
          const review = workspace.statuses.find(
            (s) => s.projectId === projectId && s.name === "En revisión",
          )!;
          await run({
            type: "status.update",
            id: done.id,
            name: "Entregado",
            color: done.color,
            isDone: true,
          });
          await run({
            type: "status.update",
            id: review.id,
            name: "Validación",
            color: review.color,
            isDone: false,
          });
          workspace = await repo.getWorkspace(actor);
        }
      }
      const modules = workspace.modules.filter(
        (m) => m.projectId === projectId,
      );
      const features = workspace.features.filter(
        (f) => f.projectId === projectId,
      );
      const tasks = workspace.tasks.filter((t) => t.projectId === projectId);
      const moduleIds: string[] = [];
      for (const [index, name] of definition.modules.entries()) {
        const key = `${definition.key}:module:${index}`;
        const existing = find(modules, key);
        let id = existing?.id ?? `preview-${key}`;
        if (existing) skipped.modules++;
        else {
          if (modules.some((m) => m.name === name))
            throw new Error(`Módulo ajeno a la carga: ${name}.`);
          added.modules++;
          if (options.apply) {
            id = await run({
              type: "module.create",
              projectId,
              name,
              description: `${notice}\n\n${marker(key)}`,
            });
            await run({
              type: "module.assignment.update",
              id,
              leaderId: index === 0 ? member.id : admin.id,
              teamMemberIds: [index === 0 ? admin.id : member.id],
            });
          }
        }
        moduleIds.push(id);
      }
      const featureIds: string[] = [];
      for (const [index, name] of definition.features.entries()) {
        const key = `${definition.key}:feature:${index}`;
        const existing = find(features, key);
        const moduleId = index < 4 ? moduleIds[Math.floor(index / 2)] : null;
        let id = existing?.id ?? `preview-${key}`;
        if (existing) {
          if (existing.moduleId !== moduleId)
            throw new Error(`La feature de ejemplo cambió de módulo: ${name}.`);
          skipped.features++;
        } else {
          if (features.some((f) => f.name === name))
            throw new Error(`Feature ajena a la carga: ${name}.`);
          added.features++;
          if (options.apply) {
            const description = `${notice}\n\n${marker(key)}`;
            const general =
              !previousProject && index === 4
                ? features.find(
                    (f) => f.moduleId === null && f.name === "General",
                  )
                : undefined;
            if (general) {
              id = general.id;
              await run({
                type: "feature.update",
                id,
                name,
                description,
                moduleId,
              });
            } else
              id = await run({
                type: "feature.create",
                projectId,
                moduleId,
                name,
                description,
              });
            await run({
              type: "feature.assignment.update",
              id,
              leaderId: index === 0 ? member.id : admin.id,
              teamMemberIds: [index === 0 ? admin.id : member.id],
            });
          }
        }
        featureIds.push(id);
      }
      for (const [index, title] of definition.tasks.entries()) {
        const key = `${definition.key}:task:${index}`;
        const existing = find(tasks, key);
        const featureId = featureIds[Math.floor(index / 4)];
        if (existing) {
          if (existing.featureId !== featureId)
            throw new Error(`La tarea de ejemplo cambió de feature: ${title}.`);
          skipped.tasks++;
          continue;
        }
        added.tasks++;
        added.checklists++;
        if (!options.apply) continue;
        const statuses = workspace.statuses.filter(
          (s) => s.projectId === projectId,
        );
        const priorities = workspace.priorities.filter(
          (p) => p.projectId === projectId,
        );
        const done = index < (definition.memberLeads ? 12 : 6) || index === 18;
        const status = done
          ? statuses.find((s) => s.isDone)!
          : statuses.filter((s) => !s.isDone)[
              index % statuses.filter((s) => !s.isDone).length
            ];
        const offset = [-3, 0, -1, 4, 7, 12][index % 6];
        const noDate = !done && index % 5 === 0;
        const taskLeader = index % 3 === 1 ? member.id : admin.id;
        const taskId = await run({
          type: "task.create",
          projectId,
          featureId,
          title,
          statusId: status.id,
          priority: priorities[index % priorities.length].id,
          typeId:
            workspace.taskTypes.find((t) => t.projectId === projectId)?.id ??
            null,
          impactId:
            workspace.impacts.find((t) => t.projectId === projectId)?.id ??
            null,
          ticketNumber: `DEMO-${definition.key.toUpperCase()}-${String(index + 1).padStart(3, "0")}`,
          description: `## Objetivo\n${title}.\n\n### Criterios de aceptación\n- El flujo principal funciona de principio a fin.\n- El equipo valida la entrega.\n\n${notice}\n\n${marker(key)}`,
          dueDate: noDate ? null : dateAt(offset),
          startDate: noDate ? null : dateAt(offset - 2),
          dueTime: !noDate && index % 2 === 0 ? "16:00" : null,
          labels: ["Ejemplo", "Dashboard"],
          leaderId: taskLeader,
          teamMemberIds:
            index % 3 === 0
              ? []
              : [taskLeader === admin.id ? member.id : admin.id],
        });
        const checklistId = await run({
          type: "checklist.create",
          taskId,
          title: "Criterios de entrega",
        });
        for (const [criterionIndex, criterion] of [
          "Validar el flujo principal",
          "Revisar con el equipo",
          "Documentar la entrega",
        ].entries()) {
          const itemId = await run({
            type: "checklist.item.create",
            checklistId,
            title: criterion,
          });
          if (done || criterionIndex === 0)
            await run({
              type: "checklist.item.update",
              id: itemId,
              title: criterion,
              completed: true,
            });
        }
        if (index >= 18)
          await run({ type: "task.archive", id: taskId, archived: true });
      }
      summary.push({ name: definition.name, projectId, leaderId });
    }
    if (options.apply) {
      const saved = await repo.getWorkspace(actor);
      for (const project of summary) {
        const exampleTasks = saved.tasks.filter(
          (t) =>
            t.projectId === project.projectId &&
            t.description.includes("<!-- taskode:example:dashboard:v1:"),
        );
        if (
          exampleTasks.length !== 20 ||
          exampleTasks.some(
            (t) =>
              !t.labels.includes("Ejemplo") ||
              t.checklists.length !== 1 ||
              t.checklists[0].items.length !== 3,
          )
        )
          throw new Error(
            "Los ejemplos no superaron la verificación. Se revierte toda la carga.",
          );
      }
    }
    return {
      mode: options.apply
        ? "aplicado"
        : "vista previa; añade --apply para guardar",
      referenceDate: date,
      users: [
        { id: admin.id, role: admin.role },
        { id: member.id, role: member.role },
      ],
      projects: summary,
      added,
      skipped,
    };
  };
  return options.apply
    ? repo.store.transaction(work)
    : repo.store.snapshot(work);
}
