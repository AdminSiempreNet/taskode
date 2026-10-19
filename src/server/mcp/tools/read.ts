import type { McpServer } from "@modelcontextprotocol/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { mentionMarkdown } from "../../../lib/mentions";
import { notificationText } from "../../../lib/notifications";
import { normalizeClientText } from "../../../lib/clients";
import { CatalogsService } from "../../catalogs";
import { DiagramsService } from "../../diagrams";
import { DocumentsService } from "../../documents";
import { MentionsService } from "../../mentions";
import { DomainError } from "../../repository";
import * as schema from "../../schema";
import type { McpContext } from "../context";
import { defineTool } from "../define";
import {
  entityUrl,
  featureName,
  loadTask,
  loadWorkspace,
  lookups,
  priorityName,
  resolveEntity,
  taskLine,
  taskMarkdown,
  taskSummary,
} from "../domain";
import { inline, list, textResult, untrusted } from "../format";
import { searchTasks } from "../search";
import { date, entity, id } from "../schemas";

export function registerReadTools(server: McpServer, ctx: McpContext) {
  defineTool(server, ctx, {
    name: "get_me",
    title: "Mi cuenta",
    description:
      "Devuelve la cuenta conectada (id, nombre, rol), los permisos concedidos a esta aplicación, el estado de configuración inicial y el límite de archivos. Úsala primero para saber quién eres en Taskode.",
    access: "read",
    input: z.object({}),
    run: async () => {
      const [state, preferences] = await Promise.all([
        ctx.repo.store.state(),
        ctx.repo.notifications.preferences(ctx.actor),
      ]);
      const user = ctx.user;
      return textResult(
        list([
          `# ${inline(user.name)}`,
          `- id: \`${user.id}\``,
          `- correo: ${user.email}`,
          `- rol: ${user.role === "admin" ? "administrador" : "miembro"}`,
          `- permisos de esta conexión: ${[...ctx.scopes].join(", ")}`,
          `- configuración inicial: ${state.onboardingStep >= 2 ? "completa" : `paso ${state.onboardingStep}`}`,
          `- tamaño máximo de archivo: ${state.maxAttachmentBytes} bytes`,
          `- recordatorios: ${preferences.offsets.join(", ")} minutos antes; tareas sin hora a las ${preferences.dateOnlyTime}`,
        ]),
        {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          scopes: [...ctx.scopes],
          onboardingStep: state.onboardingStep,
          maxAttachmentBytes: state.maxAttachmentBytes,
        },
      );
    },
  });

  defineTool(server, ctx, {
    name: "list_projects",
    title: "Listar proyectos",
    description:
      "Lista los proyectos a los que tienes acceso con su id, líder, tu rol en cada uno y el número de tareas abiertas y terminadas que puedes ver.",
    access: "read",
    input: z.object({ query: z.string().max(200).optional().describe("Filtra por nombre (sin distinguir acentos).") }),
    run: async ({ query }) => {
      const workspace = await loadWorkspace(ctx);
      const names = lookups(workspace);
      const needle = query ? normalizeClientText(query) : "";
      const projects = workspace.projects.filter(
        (project) => !needle || normalizeClientText(project.name).includes(needle),
      );
      const rows = projects.map((project) => {
        const tasks = workspace.tasks.filter((task) => task.projectId === project.id && !task.archived);
        const done = tasks.filter((task) => names.statuses.get(task.statusId)?.isDone).length;
        const role =
          ctx.user.role === "admin" ? "administrador" : project.leaderId === ctx.actor.id ? "líder" : "equipo";
        return { project, open: tasks.length - done, done, role };
      });
      const text = rows.length
        ? rows
            .map(
              ({ project, open, done, role }) =>
                `- ${project.icon} **${inline(project.name)}** (id: \`${project.id}\`) · líder ${names.person(project.leaderId)} · tu rol: ${role} · ${open} abiertas, ${done} terminadas · zona ${project.timeZone ?? "America/Bogota"} · ${entityUrl(ctx, project.id, "project", project.id)}`,
            )
            .join("\n")
        : "No tienes proyectos que coincidan.";
      return textResult(text, {
        projects: rows.map(({ project, open, done, role }) => ({
          id: project.id,
          name: project.name,
          leaderId: project.leaderId,
          role,
          openTasks: open,
          doneTasks: done,
          timeZone: project.timeZone ?? "America/Bogota",
        })),
      });
    },
  });

  defineTool(server, ctx, {
    name: "get_project_tree",
    title: "Estructura de un proyecto",
    description:
      "Devuelve la estructura de un proyecto: módulos, features (con su número), estados del tablero, prioridades, tipos, impactos, etiquetas y personas con sus ids. Imprescindible antes de crear o mover tareas.",
    access: "read",
    input: z.object({
      projectId: id,
      includeTasks: z.boolean().default(false).describe("Incluye una línea por tarea visible (no archivada)."),
    }),
    run: async ({ projectId, includeTasks }) => {
      await ctx.repo.requireProject(ctx.actor, projectId);
      const workspace = await loadWorkspace(ctx, [projectId]);
      const project = workspace.projects.find((candidate) => candidate.id === projectId);
      if (!project) throw new DomainError("El proyecto no existe o no tienes acceso.", 404);
      const names = lookups(workspace);
      const tasks = workspace.tasks.filter((task) => !task.archived);
      const featureBlock = (featureId: string) => {
        const feature = names.features.get(featureId)!;
        const own = tasks.filter((task) => task.featureId === featureId);
        return list([
          `  - feature ${featureName(names, featureId)} (id: \`${featureId}\`)${feature.pinned ? " 📌" : ""} · líder ${names.person(feature.leaderId)} · ${own.length} tareas`,
          ...(includeTasks ? own.map((task) => `    ${taskLine(ctx, names, task)}`) : []),
        ]);
      };
      const loose = workspace.features.filter((feature) => !feature.moduleId);
      const sections = [
        `# ${project.icon} ${inline(project.name)} (id: \`${project.id}\`)`,
        `Líder: ${names.person(project.leaderId)} · zona horaria ${project.timeZone ?? "America/Bogota"} · ${entityUrl(ctx, project.id, "project", project.id)}`,
        project.description ? untrusted("descripcion", project.description, { proyecto: project.id }) : "",
        "## Módulos y features",
        list([
          ...workspace.modules.map((module) =>
            list([
              `- módulo **${inline(module.name)}** (id: \`${module.id}\`) · líder ${names.person(module.leaderId)}`,
              ...workspace.features.filter((feature) => feature.moduleId === module.id).map((feature) => featureBlock(feature.id)),
            ]),
          ),
          loose.length ? list(["- sin módulo", ...loose.map((feature) => featureBlock(feature.id))]) : "",
        ]) || "_Sin features todavía._",
        "## Estados (columnas, en orden)",
        workspace.statuses
          .map((status) => `- ${inline(status.name)} (id: \`${status.id}\`)${status.isDone ? " — cuenta como terminada" : ""}`)
          .join("\n"),
        "## Prioridades",
        workspace.priorities.map((priority) => `- ${priorityName(names, priority.id)} (id: \`${priority.id}\`)`).join("\n"),
        "## Tipos",
        workspace.taskTypes.map((type) => `- ${inline(type.name)} (id: \`${type.id}\`)`).join("\n") || "_Ninguno._",
        "## Impactos",
        workspace.impacts.map((impact) => `- ${inline(impact.name)} (id: \`${impact.id}\`)`).join("\n") || "_Ninguno._",
        "## Aplicaciones",
        workspace.applications.map(app => `- ${inline(app.name)} (id: \`${app.id}\`)${app.isDefault ? " — predeterminada" : ""}`).join("\n") || "_Ninguna._",
        "## Etiquetas",
        workspace.labels.map((label) => `- ${inline(label.name)} (id: \`${label.id}\`)`).join("\n") || "_Ninguna._",
        "## Personas con acceso",
        (workspace.people ?? [])
          .map((person) => `- ${inline(person.name)} <${person.email}> (id: \`${person.id}\`)`)
          .join("\n"),
      ];
      return textResult(sections.filter(Boolean).join("\n\n"), {
        project: { id: project.id, name: project.name, leaderId: project.leaderId, timeZone: project.timeZone ?? "America/Bogota" },
        modules: workspace.modules.map(({ id, name, leaderId, applicationIds }) => ({ id, name, leaderId: leaderId ?? null, applicationIds })),
        features: workspace.features.map(({ id, number, name, moduleId, pinned, leaderId, applicationIds }) => ({
          id, number, name, moduleId, pinned, leaderId: leaderId ?? null, applicationIds,
        })),
        statuses: workspace.statuses.map(({ id, name, isDone, position }) => ({ id, name, isDone, position })),
        priorities: workspace.priorities.map(({ id, name }) => ({ id, name })),
        taskTypes: workspace.taskTypes.map(({ id, name }) => ({ id, name })),
        impacts: workspace.impacts.map(({ id, name }) => ({ id, name })),
        applications: workspace.applications.map(({ id, name, color, isDefault }) => ({ id, name, color, isDefault })),
        labels: workspace.labels.map(({ id, name }) => ({ id, name })),
        people: (workspace.people ?? []).map(({ id, name, email }) => ({ id, name, email })),
      });
    },
  });

  defineTool(server, ctx, {
    name: "search_tasks",
    title: "Buscar tareas",
    description:
      "Busca tareas visibles para ti con filtros combinables (proyecto, módulo, feature, texto, estado, responsable, prioridad, tipo, impacto, aplicaciones, etiquetas, cliente, ticket, fechas, vencidas, archivadas). Devuelve una línea por tarea con su id; usa get_task para el detalle.",
    access: "read",
    input: z.object({
      projectId: id.optional(),
      moduleId: id.optional(),
      featureId: id.optional(),
      query: z.string().max(200).optional().describe("Texto en título, descripción, número de ticket o etiquetas."),
      statusIds: z.array(id).max(50).optional(),
      done: z.boolean().optional().describe("true: solo terminadas; false: solo pendientes."),
      assignee: z.string().max(200).optional().describe('"me", "unassigned" o el id de una persona (líder o equipo).'),
      priorityIds: z.array(id).max(20).optional(),
      typeIds: z.array(z.string().max(200)).max(20).optional(),
      impactIds: z.array(z.string().max(200)).max(20).optional(),
      applicationIds: z.array(id).max(20).optional().describe("Coincide con cualquiera de estas aplicaciones; __unassigned__ incluye tareas sin aplicación."),
      labels: z.array(z.string().max(60)).max(20).optional().describe("Nombres de etiqueta (cualquiera)."),
      clientId: id.optional(),
      ticketId: id.optional(),
      dueFrom: date.optional(),
      dueTo: date.optional(),
      overdue: z.boolean().optional(),
      archived: z.boolean().default(false),
      sort: z.enum(["due", "updated", "created", "position"]).default("due"),
      limit: z.number().int().min(1).max(100).default(25),
      offset: z.number().int().min(0).default(0),
    }),
    run: async (filters) => {
      if (filters.projectId) await ctx.repo.requireProject(ctx.actor, filters.projectId);
      const workspace = await loadWorkspace(ctx, filters.projectId ? [filters.projectId] : undefined, true);
      const names = lookups(workspace);
      const result = searchTasks(workspace, filters, ctx.actor.id);
      const header = `${result.total} tareas${result.total > result.limit ? ` (mostrando ${result.offset + 1}–${Math.min(result.total, result.offset + result.limit)})` : ""}`;
      const projectNames = (projectId: string) => inline(names.projects.get(projectId)?.name ?? projectId);
      return textResult(
        list([
          header,
          ...result.tasks.map(
            (task) => `${taskLine(ctx, names, task)}${filters.projectId ? "" : ` · ${projectNames(task.projectId)}`}`,
          ),
        ]),
        { total: result.total, offset: result.offset, limit: result.limit, tasks: result.tasks.map((task) => taskSummary(names, task)) },
      );
    },
  });

  defineTool(server, ctx, {
    name: "get_task",
    title: "Ver tarea",
    description:
      "Devuelve una tarea completa: datos, descripción, checklist con ids de ítems, archivos, comentarios recientes e historial de estados.",
    access: "read",
    input: z.object({
      taskId: id,
      includeComments: z.boolean().default(true),
      includeHistory: z.boolean().default(false),
    }),
    run: async ({ taskId, includeComments, includeHistory }) => {
      const { task, workspace } = await loadTask(ctx, taskId);
      return textResult(
        taskMarkdown(ctx, workspace, task, { comments: includeComments, history: includeHistory }),
        {
          task: {
            ...taskSummary(lookups(workspace), task),
            description: task.description,
            typeId: task.typeId,
            impactId: task.impactId,
            startTime: task.startTime,
            clientIds: task.clientIds,
            ticketIds: task.ticketIds,
            checklist: task.checklists[0] ?? null,
            permissions: task.permissions ?? null,
          },
        },
      );
    },
  });

  defineTool(server, ctx, {
    name: "get_entity",
    title: "Ver proyecto, módulo o feature",
    description:
      "Devuelve el detalle de un proyecto, módulo, feature o tarea: descripción, líder, equipo, clientes y tickets vinculados, permisos, y opcionalmente sus documentos, diagramas, archivos y comentarios.",
    access: "read",
    input: z.object({
      entity,
      include: z
        .array(z.enum(["documents", "diagrams", "files", "comments"]))
        .default(["documents", "diagrams", "files"]),
    }),
    run: async ({ entity: target, include }) => {
      const detail = await ctx.repo.entityDetail(ctx.actor, target.kind, target.id);
      const raw = detail.entity as unknown as Record<string, unknown> & {
        name?: string;
        title?: string;
        description?: string;
        leaderId?: string;
        teamMemberIds?: string[];
        clientIds: string[];
        ticketIds: string[];
        applicationIds?: string[];
      };
      const workspace = await loadWorkspace(ctx, [detail.scope.projectId], true);
      const names = lookups(workspace);
      const title = raw.name ?? raw.title ?? target.id;
      const sections = [
        `# ${{ project: "Proyecto", module: "Módulo", feature: "Feature", task: "Tarea" }[target.kind]}: ${inline(title)}`,
        list([
          `- id: \`${target.id}\` · proyecto \`${detail.scope.projectId}\``,
          `- enlace: ${entityUrl(ctx, detail.scope.projectId, target.kind, target.id)}`,
          target.kind === "feature" && `- número: #${String(raw.number)}`,
          `- líder: ${names.person(raw.leaderId)}`,
          raw.teamMemberIds?.length && `- equipo: ${raw.teamMemberIds.map((member) => `${names.person(member)} (\`${member}\`)`).join(", ")}`,
          raw.clientIds.length && `- clientes: ${raw.clientIds.map((client) => `${inline(names.clients.get(client)?.name ?? client)} (\`${client}\`)`).join(", ")}`,
          raw.applicationIds?.length && `- aplicaciones: ${raw.applicationIds.map(app => inline(names.applications.get(app)?.name ?? app)).join(", ")}`,
          raw.ticketIds.length && `- tickets: ${raw.ticketIds.map((ticket) => `${inline(names.tickets.get(ticket)?.number ?? ticket)} (\`${ticket}\`)`).join(", ")}`,
          `- permisos: editar ${detail.permissions.canEdit ? "sí" : "no"}, eliminar ${detail.permissions.canDelete ? "sí" : "no"}, gestionar acceso ${detail.permissions.canManageAccess ? "sí" : "no"}, archivos ${detail.permissions.canManageFiles ? "sí" : "no"}`,
        ]),
        "## Descripción",
        raw.description ? untrusted("descripcion", raw.description, { [target.kind]: target.id }) : "_Sin descripción._",
      ];
      if (include.includes("documents")) {
        const { documents } = await new DocumentsService(ctx.repo).list(ctx.actor, target.kind, target.id);
        sections.push(
          "## Documentos",
          documents.map((doc) => `- ${inline(doc.title)} (id: \`${doc.id}\`, revisión ${doc.revision}, ${doc.updatedAt})`).join("\n") || "_Ninguno._",
        );
      }
      if (include.includes("diagrams")) {
        const { diagrams } = await new DiagramsService(ctx.repo).list(ctx.actor, target.kind, target.id);
        sections.push(
          "## Diagramas",
          diagrams
            .map((diagram) => `- ${inline(diagram.title)} (id: \`${diagram.id}\`, revisión ${diagram.revision}${diagram.isPublic ? ", enlace público activo" : ""})`)
            .join("\n") || "_Ninguno._",
        );
      }
      if (include.includes("files"))
        sections.push(
          "## Archivos",
          detail.files.map((file) => `- ${inline(file.name)} · ${file.mimeType} · ${file.size} bytes (id: \`${file.id}\`)`).join("\n") || "_Ninguno._",
        );
      if (include.includes("comments")) {
        const { comments } = await ctx.repo.entityComments(ctx.actor, target.kind, target.id);
        sections.push(
          `## Comentarios (${comments.length})`,
          comments
            .slice(-30)
            .map((comment) =>
              untrusted("comentario", comment.content, { id: comment.id, autor: comment.author?.name ?? "desconocido", fecha: comment.createdAt }),
            )
            .join("\n") || "_Sin comentarios._",
        );
      }
      return textResult(sections.join("\n\n"), {
        scope: detail.scope,
        permissions: detail.permissions,
        leaderId: raw.leaderId ?? null,
        teamMemberIds: raw.teamMemberIds ?? [],
        clientIds: raw.clientIds,
        ticketIds: raw.ticketIds,
        ...(target.kind === "project" ? {} : { applicationIds: raw.applicationIds ?? [] }),
      });
    },
  });

  defineTool(server, ctx, {
    name: "list_notifications",
    title: "Mis avisos",
    description: "Lista tus avisos (asignaciones, menciones, recordatorios, accesos). Usa nextCursor para paginar.",
    access: "read",
    input: z.object({
      filter: z.enum(["all", "unread"]).default("unread"),
      cursor: z.string().max(200).optional(),
      limit: z.number().int().min(1).max(50).default(20),
    }),
    run: async ({ filter, cursor, limit }) => {
      const snapshot = await ctx.repo.notifications.list(ctx.actor, { filter, cursor, limit });
      return textResult(
        list([
          `${snapshot.unreadCount} sin leer.`,
          ...snapshot.items.map(
            (item) =>
              `- ${item.readAt ? "" : "● "}${inline(notificationText(item))}: ${inline(item.entityTitle ?? item.taskTitle)} · ${inline(item.projectName)} · ${item.createdAt} (id: \`${item.id}\`)`,
          ),
          snapshot.nextCursor && `Más resultados con cursor \`${snapshot.nextCursor}\`.`,
        ]),
        {
          unreadCount: snapshot.unreadCount,
          nextCursor: snapshot.nextCursor,
          through: snapshot.through,
          items: snapshot.items.map(({ id, type, taskId, scope, projectId, readAt, createdAt }) => ({
            id, type, taskId, scope: scope ?? null, projectId, readAt, createdAt,
          })),
        },
      );
    },
  });

  defineTool(server, ctx, {
    name: "get_mention_options",
    title: "Opciones de mención",
    description:
      "Devuelve las personas, clientes y tickets que se pueden mencionar en un elemento, con el Markdown exacto para insertarlos en comentarios, descripciones o documentos. Mencionar a una persona le envía un aviso.",
    access: "read",
    input: z.object({ entity }),
    run: async ({ entity: target }) => {
      const { scope } = await resolveEntity(ctx, target.kind, target.id);
      const options = await new MentionsService(ctx.repo).options(ctx.actor, { scope });
      const block = (title: string, rows: string[]) => `## ${title}\n${rows.join("\n") || "_Ninguno._"}`;
      return textResult(
        [
          block(
            "Personas",
            options.users.map((user) => `- ${inline(user.name)} <${user.email}> → \`${mentionMarkdown({ type: "user", id: user.id }, user.name)}\``),
          ),
          block(
            "Clientes",
            options.clients.slice(0, 100).map((client) => `- ${inline(client.name)} (${inline(client.cityName)}) → \`${mentionMarkdown({ type: "client", id: client.id }, client.name)}\``),
          ),
          block(
            "Tickets",
            options.tickets.slice(0, 100).map((ticket) => `- ${inline(ticket.number)} → \`${mentionMarkdown({ type: "ticket", id: ticket.id }, ticket.number)}\``),
          ),
        ].join("\n\n"),
      );
    },
  });

  defineTool(server, ctx, {
    name: "search_catalog",
    title: "Buscar clientes, tickets o ciudades",
    description:
      "Busca en los catálogos globales: clientes (por nombre, ciudad o departamento), tickets (por número, descripción, enlace o cliente) o ciudades de Colombia (para crear clientes).",
    access: "read",
    input: z.object({
      catalog: z.enum(["clients", "tickets", "cities"]),
      query: z.string().max(200).default(""),
      clientId: id.optional().describe("Solo tickets: filtra por cliente."),
      withoutClient: z.boolean().optional().describe("Solo tickets: sin cliente."),
      page: z.number().int().min(1).default(1),
      pageSize: z.enum(["10", "25", "50", "100"]).default("25"),
    }),
    run: async ({ catalog, query, clientId, withoutClient, page, pageSize }) => {
      const service = new CatalogsService(ctx.repo);
      const size = Number(pageSize);
      if (catalog === "cities") {
        const geography = await ctx.repo.getGeography(ctx.actor);
        const departments = new Map(geography.departments.map((department) => [department.id, department.name]));
        const needle = normalizeClientText(query);
        const cities = geography.cities.filter(
          (city) => !needle || normalizeClientText(`${city.name} ${departments.get(city.departmentId) ?? ""}`).includes(needle),
        );
        const slice = cities.slice((page - 1) * size, page * size);
        return textResult(
          list([
            `${cities.length} ciudades.`,
            ...slice.map((city) => `- ${city.name}, ${departments.get(city.departmentId)} (id: \`${city.id}\`)`),
          ]),
          { total: cities.length, items: slice.map((city) => ({ id: city.id, name: city.name, department: departments.get(city.departmentId) })) },
        );
      }
      if (catalog === "clients") {
        const result = await service.clients(ctx.actor, { q: query, page, pageSize: size });
        return textResult(
          list([
            `${result.total} clientes (página ${result.page}/${result.totalPages}).`,
            ...result.items.map((client) => `- ${inline(client.name)} · ${client.cityName}, ${client.departmentName} (id: \`${client.id}\`)`),
          ]),
          { ...result, items: result.items.map(({ id, name, cityId, cityName, departmentName }) => ({ id, name, cityId, cityName, departmentName })) },
        );
      }
      const result = await service.tickets(ctx.actor, { q: query, page, pageSize: size, clientId, withoutClient });
      return textResult(
        list([
          `${result.total} tickets (página ${result.page}/${result.totalPages}).`,
          ...result.items.map(
            (ticket) =>
              `- ${inline(ticket.number)}${ticket.client ? ` · ${inline(ticket.client.name)}` : ""}${ticket.url ? ` · ${ticket.url}` : ""} (id: \`${ticket.id}\`)`,
          ),
        ]),
        {
          ...result,
          items: result.items.map(({ id, number, url, clientId }) => ({ id, number, url, clientId })),
        },
      );
    },
  });

  defineTool(server, ctx, {
    name: "get_ticket",
    title: "Ver ticket",
    description: "Devuelve un ticket con su descripción, cliente y los proyectos, módulos, features y tareas vinculados que puedes ver.",
    access: "read",
    input: z.object({ ticketId: id }),
    run: async ({ ticketId }) => {
      const [ticket] = await ctx.repo.store.db.select().from(schema.tickets).where(eq(schema.tickets.id, ticketId));
      if (!ticket) throw new DomainError("El ticket no existe.", 404);
      const [client] = ticket.clientId
        ? await ctx.repo.store.db.select().from(schema.clients).where(eq(schema.clients.id, ticket.clientId))
        : [];
      const service = new CatalogsService(ctx.repo);
      const links = [];
      for (const kind of ["project", "module", "feature", "task"] as const) {
        const page = await service.ticketLinks(ctx.actor, ticketId, kind, { q: "", page: 1, pageSize: 100 });
        links.push(...page.items);
      }
      return textResult(
        [
          `# Ticket ${inline(ticket.number)} (id: \`${ticket.id}\`)`,
          list([client && `- cliente: ${inline(client.name)} (\`${client.id}\`)`, ticket.url && `- enlace: ${ticket.url}`]),
          ticket.description ? untrusted("ticket", ticket.description, { id: ticket.id }) : "_Sin descripción._",
          "## Vinculado a",
          links.map((item) => `- ${item.kind}: ${inline(item.name)} · ${inline(item.projectName)} (id: \`${item.id}\`)`).join("\n") || "_Nada visible para ti._",
        ]
          .filter(Boolean)
          .join("\n\n"),
        { id: ticket.id, number: ticket.number, url: ticket.url, clientId: ticket.clientId, links },
      );
    },
  });
}
