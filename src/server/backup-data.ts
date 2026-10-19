import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { getTableColumns, sql, and, isNull } from "drizzle-orm";
import type { AnyPgTable } from "drizzle-orm/pg-core";
import { z } from "zod";
import * as schema from "./schema";
import type { DatabaseStore } from "./database";
import { DomainError } from "./repository";
import { MAX_BACKUP_BYTES } from "../lib/backups";
import divipola from "./catalogs/divipola.json";
import { normalizeClientText } from "../lib/clients";
import { ticketInputSchema } from "../lib/tickets";
import { documentInputSchema } from "../lib/documents";
import { fileTypes } from "../lib/files";
import { validTimeZone } from "../lib/project-time";
import { notificationPreferencesSchema } from "../lib/notifications";
import { diagramBytes, diagramInputSchema, diagramSceneSchema, MAX_DIAGRAM_BYTES, type DiagramScene } from "../lib/diagrams";

// The order also defines insertion order. Sessions, verification and migration
// metadata are deliberately not portable application data.
export const backupTables = {
  departments: schema.departments,
  cities: schema.cities,
  clients: schema.clients,
  tickets: schema.tickets,
  user: schema.user,
  account: schema.account,
  installation: schema.installation,
  projects: schema.projects,
  project_team_members: schema.projectTeamMembers,
  modules: schema.modules,
  features: schema.features,
  module_team_members: schema.moduleTeamMembers,
  feature_team_members: schema.featureTeamMembers,
  statuses: schema.statuses,
  priorities: schema.priorities,
  task_types: schema.taskTypes,
  impacts: schema.impacts,
  labels: schema.labels,
  tasks: schema.tasks,
  diagrams: schema.diagrams,
  documents: schema.documents,
  task_clients: schema.taskClients,
  project_clients: schema.projectClients,
  module_clients: schema.moduleClients,
  feature_clients: schema.featureClients,
  project_tickets: schema.projectTickets,
  module_tickets: schema.moduleTickets,
  feature_tickets: schema.featureTickets,
  task_tickets: schema.taskTickets,
  task_team_members: schema.taskTeamMembers,
  files: schema.files,
  checklists: schema.checklists,
  checklist_items: schema.checklistItems,
  comments: schema.comments,
  task_status_history: schema.taskStatusHistory,
  invitations: schema.invitations,
  invitation_projects: schema.invitationProjects,
  notification_preferences: schema.notificationPreferences,
  notifications: schema.notifications,
};
type BackupRow = Record<string, string | number | boolean | string[] | DiagramScene | null>;
const tableValidators: Record<string, z.ZodType> = {};
const version10Validators: Record<string, z.ZodType> = {};
const version11Tables = ["tickets", "project_clients", "module_clients", "feature_clients", "project_tickets", "module_tickets", "feature_tickets", "task_tickets"];
const version9Validators: Record<string, z.ZodType> = {};
const version8Validators: Record<string, z.ZodType> = {};
const version7Validators: Record<string, z.ZodType> = {};
const version6Validators: Record<string, z.ZodType> = {};
const version5Validators: Record<string, z.ZodType> = {};
const version4Validators: Record<string, z.ZodType> = {};
const version3Validators: Record<string, z.ZodType> = {};
const version2Validators: Record<string, z.ZodType> = {};
for (const [name, table] of Object.entries(backupTables)) {
  const fields: Record<string, z.ZodType> = {};
  for (const [key, column] of Object.entries(getTableColumns(table))) {
    let field: z.ZodType;
    switch (column.dataType) {
      case "boolean":
        field = z.boolean();
        break;
      case "number":
        field =
          column.getSQLType() === "integer"
            ? z.int32()
            : column.getSQLType() === "bigint"
              ? z.number().int().safe()
              : z.number();
        break;
      case "date":
        field = z.iso.datetime();
        break;
      case "json":
        field = name === "diagrams" && key === "scene" ? diagramSceneSchema : z.array(z.string());
        break;
      default:
        field = column.enumValues?.length
          ? z.enum(column.enumValues as [string, ...string[]])
          : z.string();
    }
    fields[key] = column.notNull ? field : field.nullable();
  }
  tableValidators[name] = z.array(z.strictObject({ ...fields }));
  if (version11Tables.includes(name)) continue;
  if (name === "tasks") fields.ticketNumber = z.string().nullable();
  version10Validators[name] = z.array(z.strictObject({ ...fields }));
  if (name === "notifications") {
    for (const key of ["projectId", "scopeType", "moduleId", "featureId", "commentId", "documentId"]) delete fields[key];
    fields.taskId = z.string();
    fields.type = z.enum(["assigned", "shared", "reminder"]);
  }
  version9Validators[name] = z.array(z.strictObject({ ...fields }));
  if (name === "documents") continue;
  version8Validators[name] = z.array(z.strictObject({ ...fields }));
  if (name === "diagrams") continue;
  version7Validators[name] = z.array(z.strictObject({ ...fields }));
  if (["notification_preferences", "notifications"].includes(name)) continue;
  if (name === "projects") delete fields.timeZone;
  version6Validators[name] = z.array(z.strictObject({ ...fields }));
  if (["module_team_members", "feature_team_members"].includes(name)) continue;
  const legacyName = name === "project_team_members" ? "project_members" : name;
  const version5Fields = { ...fields };
  if (["projects", "modules", "features"].includes(name)) {
    version5Fields.ownerId = version5Fields.leaderId;
    delete version5Fields.leaderId;
  }
  version5Validators[legacyName] = z.array(z.strictObject(version5Fields));
  const version4Fields = { ...version5Fields };
  if (name === "comments" || name === "files") {
    for (const key of ["scopeType", "moduleId", "featureId"])
      delete version4Fields[key];
    if (name === "comments") {
      delete version4Fields.projectId;
      version4Fields.taskId = z.string();
    }
  }
  version4Validators[legacyName] = z.array(z.strictObject(version4Fields));
  const version3Fields = { ...version4Fields };
  if (name === "tasks") {
    version3Fields.assigneeId = version3Fields.leaderId;
    delete version3Fields.leaderId;
  }
  version3Validators[
    name === "task_team_members" ? "task_collaborators" : legacyName
  ] = z.array(z.strictObject(version3Fields));
  const legacyFields = { ...version4Fields };
  for (const key of (
    {
      installation: ["maxAttachmentBytes"],
      modules: ["ownerId"],
      features: ["ownerId"],
      tasks: ["createdById", "leaderId"],
      comments: ["authorId"],
    } as Record<string, string[]>
  )[name] ?? [])
    delete legacyFields[key];
  if (!["task_team_members", "files"].includes(name))
    version2Validators[legacyName] = z.array(z.strictObject(legacyFields));
}
const backupHeader = {
  // Existing backups remain restorable; all new exports use the Taskode format.
  format: z
    .enum(["taskode-backup", "brote-backup"])
    .transform(() => "taskode-backup" as const),
  createdAt: z.iso.datetime(),
};
const newTables = ["departments", "cities", "clients", "task_clients"];
const legacyTableValidators = Object.fromEntries(
  Object.entries(version2Validators).filter(
    ([name]) => !newTables.includes(name),
  ),
);
const fileSchema = z
  .union([
    z.strictObject({
      ...backupHeader,
      version: z.literal(11),
      tables: z.strictObject(tableValidators),
    }),
    z.strictObject({
      ...backupHeader,
      version: z.literal(10),
      tables: z.strictObject(version10Validators),
    }),
    z.strictObject({
      ...backupHeader,
      version: z.literal(9),
      tables: z.strictObject(version9Validators),
    }),
    z.strictObject({
      ...backupHeader,
      version: z.literal(8),
      tables: z.strictObject(version8Validators),
    }),
    z.strictObject({
      ...backupHeader,
      version: z.literal(7),
      tables: z.strictObject(version7Validators),
    }),
    z.strictObject({
      ...backupHeader,
      version: z.literal(6),
      tables: z.strictObject(version6Validators),
    }),
    z.strictObject({
      ...backupHeader,
      version: z.literal(5),
      tables: z.strictObject(version5Validators),
    }),
    z.strictObject({
      ...backupHeader,
      version: z.literal(4),
      tables: z.strictObject(version4Validators),
    }),
    z.strictObject({
      ...backupHeader,
      version: z.literal(3),
      tables: z.strictObject(version3Validators),
    }),
    z.strictObject({
      ...backupHeader,
      version: z.literal(2),
      tables: z.strictObject(version2Validators),
    }),
    z
      .strictObject({
        ...backupHeader,
        version: z.literal(1),
        tables: z.strictObject(legacyTableValidators),
      })
      .transform((legacy) => ({
        ...legacy,
        version: 2 as const,
        tables: {
          ...legacy.tables,
          departments: divipola.departments,
          cities: divipola.cities,
          clients: [],
          task_clients: [],
        },
      })),
  ])
  .transform((input) => {
    if (input.version >= 4) return input;
    if (input.version === 3) {
      const { task_collaborators, ...tables } = input.tables as Record<
        string,
        Record<string, unknown>[]
      >;
      return {
        ...input,
        version: 4 as const,
        tables: {
          ...tables,
          tasks: tables.tasks.map(({ assigneeId, ...task }) => ({
            ...task,
            leaderId: assigneeId,
          })),
          task_team_members: task_collaborators,
        },
      };
    }
    const tables = input.tables as Record<string, Record<string, unknown>[]>;
    const owner = (projectId: unknown) =>
      tables.projects.find((p) => p.id === projectId)?.ownerId;
    return {
      ...input,
      version: 4 as const,
      tables: {
        ...tables,
        installation: tables.installation.map((r) => ({
          ...r,
          maxAttachmentBytes: 10485760,
        })),
        modules: tables.modules.map((r) => ({
          ...r,
          ownerId: owner(r.projectId),
        })),
        features: tables.features.map((r) => ({
          ...r,
          ownerId: owner(r.projectId),
        })),
        tasks: tables.tasks.map((r) => ({
          ...r,
          createdById: null,
          leaderId: owner(r.projectId),
        })),
        comments: tables.comments.map((r) => ({ ...r, authorId: null })),
        task_team_members: [],
        files: [],
      },
    };
  })
  .transform((input) => {
    if (input.version >= 5) return input;
    const tables = input.tables as Record<string, BackupRow[]>;
    return {
      ...input,
      version: 5 as const,
      tables: {
        ...tables,
        comments: tables.comments.map((c) => ({
          ...c,
          scopeType: "task",
          moduleId: null,
          featureId: null,
          projectId: tables.tasks.find((t) => t.id === c.taskId)?.projectId,
        })),
        files: tables.files.map((f) => ({
          ...f,
          scopeType: f.taskId === null ? null : "task",
          moduleId: null,
          featureId: null,
        })),
      },
    };
  })
  .transform((input) => {
    if (input.version >= 6) return input;
    const { project_members, ...tables } = input.tables as Record<
      string,
      BackupRow[]
    >;
    const renameLeader = ({ ownerId, ...row }: BackupRow) => ({
      ...row,
      leaderId: ownerId,
    });
    return {
      ...input,
      version: 6 as const,
      tables: {
        ...tables,
        projects: tables.projects.map(renameLeader),
        modules: tables.modules.map(renameLeader),
        features: tables.features.map(renameLeader),
        project_team_members: project_members,
        module_team_members: [],
        feature_team_members: [],
      },
    };
  })
  .transform((input) => {
    if (input.version >= 7) return input;
    const tables = input.tables as Record<string, BackupRow[]>;
    return { ...input, version: 7 as const, tables: { ...tables,
      projects: tables.projects.map((p) => ({ ...p, timeZone: "America/Bogota" })),
      notification_preferences: [], notifications: [],
    } };
  })
  .transform((input) => input.version >= 8 ? input : ({
    ...input, version: 8 as const, tables: { ...input.tables, diagrams: [] },
  }))
  .transform((input) => {
    if (input.version >= 9) return input;
    const tables = input.tables as Record<string, BackupRow[]>;
    return { ...input, version: 9, tables: { ...tables, documents: tables.documents ?? [],
      files: tables.files.map((file) => ({ ...file, purpose: file.purpose === "document" ? "file" : file.purpose })),
    } };
  })
  .transform((input) => {
    if (input.version >= 10) return input;
    const tables = input.tables as Record<string, BackupRow[]>;
    return { ...input, version: 10 as const, tables: { ...tables,
      notifications: tables.notifications.map(n => ({ ...n,
        projectId: tables.tasks.find(t => t.id === n.taskId)?.projectId ?? "",
        scopeType: "task", moduleId: null, featureId: null, commentId: null, documentId: null,
      })),
    } };
  })
  .transform((input) => {
    if (input.version >= 11) return input;
    const tables = input.tables as Record<string, BackupRow[]>;
    const tickets: BackupRow[] = [], taskTickets: BackupRow[] = [];
    const tasks = tables.tasks.map(({ ticketNumber, ...task }) => {
      const number = String(ticketNumber ?? "").trim();
      if (number) {
        const id = `legacy-ticket:${createHash("md5").update(String(task.id)).digest("hex")}`;
        const clients = tables.task_clients.filter((link) => link.taskId === task.id);
        tickets.push({ id, number, description: "", url: null, clientId: clients.length === 1 ? clients[0].clientId : null, createdAt: task.createdAt, updatedAt: task.updatedAt });
        taskTickets.push({ taskId: task.id, ticketId: id });
      }
      return task;
    });
    return { ...input, version: 11 as const, tables: { ...tables, tasks, tickets, task_tickets: taskTickets,
      project_clients: [], module_clients: [], feature_clients: [], project_tickets: [], module_tickets: [], feature_tickets: [],
    } };
  })
  .pipe(
    z.strictObject({
      format: z.literal("taskode-backup"),
      createdAt: z.iso.datetime(),
      version: z.literal(11),
      tables: z.strictObject(tableValidators),
    }),
  );
export type ApplicationBackup = {
  format: "taskode-backup";
  version: 11;
  createdAt: string;
  tables: Record<string, BackupRow[]>;
};

function invalid(
  message = "El respaldo está incompleto o tiene referencias inválidas.",
): never {
  throw new DomainError(message);
}
export function validateApplicationBackup(input: unknown): ApplicationBackup {
  const parsed = fileSchema.safeParse(input);
  if (!parsed.success)
    invalid(
      "El archivo no es un respaldo JSON compatible de Taskode (versiones 1–11).",
    );
  const backup = parsed.data as ApplicationBackup;
  const data = backup.tables;
  for (const ticket of data.tickets)
    if (!ticketInputSchema.safeParse(ticket).success || ticket.number !== String(ticket.number).trim())
      invalid("El respaldo contiene un ticket inválido.");
  for (const document of data.documents) {
    if (!documentInputSchema.safeParse({ title: document.title, description: document.description, content: document.content }).success || !Number.isInteger(document.revision) || Number(document.revision) < 1) invalid("El respaldo contiene un documento inválido.");
  }
  for (const diagram of data.diagrams) {
    const value = { title: diagram.title, description: diagram.description, scene: diagram.scene };
    if (!diagramInputSchema.safeParse(value).success || diagramBytes(value) > MAX_DIAGRAM_BYTES || !Number.isInteger(diagram.revision) || Number(diagram.revision) < 1) invalid("El respaldo contiene un diagrama inválido.");
    // Public links are operational capabilities, never restored from a backup.
    diagram.publicToken = null;
  }
  for (const p of data.projects) if (!validTimeZone(String(p.timeZone))) invalid();
  for (const p of data.notification_preferences) {
    if (!data.user.some((u) => u.id === p.userId) || !notificationPreferencesSchema.safeParse({ offsets: (p.offsets as string[]).map(Number), dateOnlyTime: p.dateOnlyTime }).success) invalid();
  }
  for (const n of data.notifications) {
    if (!data.user.some((u) => u.id === n.recipientId) || (n.actorId !== null && !data.user.some((u) => u.id === n.actorId))) invalid();
    const target = n.scopeType === "project" ? data.projects.find(p => p.id === n.projectId)
      : (n.scopeType === "task" ? data.tasks : n.scopeType === "module" ? data.modules : data.features)
        .find(t => t.id === (n.scopeType === "task" ? n.taskId : n.scopeType === "module" ? n.moduleId : n.featureId) && t.projectId === n.projectId);
    if (!target || [n.taskId, n.moduleId, n.featureId].filter(v => v !== null).length !== (n.scopeType === "project" ? 0 : 1)) invalid();
    if (n.commentId !== null && n.documentId !== null) invalid();
    for (const [key, rows] of [["commentId", data.comments], ["documentId", data.documents]] as const) {
      if (n[key] !== null && !rows.some(row => row.id === n[key] && row.projectId === n.projectId && row.scopeType === n.scopeType && row.taskId === n.taskId && row.moduleId === n.moduleId && row.featureId === n.featureId)) invalid();
    }
    if (n.type !== "mention" && (n.scopeType !== "task" || n.commentId !== null || n.documentId !== null)) invalid();
    if (n.offsetMinutes !== null && ![15, 60, 1440, 4320, 10080].includes(Number(n.offsetMinutes))) invalid();
  }
  if (new Set(data.notifications.map((n) => n.dedupKey)).size !== data.notifications.length) invalid();
  if (new Set(data.notifications.map((n) => n.sequence)).size !== data.notifications.length || data.notifications.some((n) => !Number.isSafeInteger(n.sequence) || Number(n.sequence) < 1)) invalid();
  for (const rows of Object.values(data))
    for (const row of rows)
      for (const key of ["createdAt", "updatedAt", "changedAt"])
        if (
          typeof row[key] === "string" &&
          !z.iso.datetime().safeParse(row[key]).success
        )
          invalid("El respaldo contiene una fecha de registro inválida.");
  const indexes = new Map<string, Set<string>>();
  const has = (table: string, values: unknown[], keys = ["id"]) => {
    const name = `${table}:${keys.join(",")}`;
    if (!indexes.has(name))
      indexes.set(
        name,
        new Set(
          data[table].map((row) => JSON.stringify(keys.map((key) => row[key]))),
        ),
      );
    return indexes.get(name)!.has(JSON.stringify(values));
  };
  const references = [
    ["tickets", "clientId", "clients"],
    ...(["project", "module", "feature", "task"] as const).flatMap((kind) =>
      (["client", "ticket"] as const).flatMap((item) => [
        [`${kind}_${item}s`, `${kind}Id`, kind === "feature" ? "features" : `${kind}s`],
        [`${kind}_${item}s`, `${item}Id`, `${item}s`],
      ])),
    ["documents", "projectId", "projects"],
    ["documents", "moduleId", "modules"],
    ["documents", "featureId", "features"],
    ["documents", "taskId", "tasks"],
    ["diagrams", "projectId", "projects"],
    ["diagrams", "moduleId", "modules"],
    ["diagrams", "featureId", "features"],
    ["diagrams", "taskId", "tasks"],
    ["cities", "departmentId", "departments"],
    ["clients", "cityId", "cities"],
    ["task_clients", "taskId", "tasks"],
    ["task_clients", "clientId", "clients"],
    ["account", "userId", "user"],
    ["modules", "leaderId", "user"],
    ["module_team_members", "moduleId", "modules"],
    ["module_team_members", "userId", "user"],
    ["feature_team_members", "featureId", "features"],
    ["feature_team_members", "userId", "user"],
    ["features", "leaderId", "user"],
    ["tasks", "createdById", "user"],
    ["tasks", "leaderId", "user"],
    ["comments", "authorId", "user"],
    ["comments", "projectId", "projects"],
    ["comments", "moduleId", "modules"],
    ["comments", "featureId", "features"],
    ["files", "moduleId", "modules"],
    ["files", "featureId", "features"],
    ["task_team_members", "taskId", "tasks"],
    ["task_team_members", "userId", "user"],
    ["files", "projectId", "projects"],
    ["files", "taskId", "tasks"],
    ["files", "uploadedBy", "user"],
    ["installation", "adminId", "user"],
    ["projects", "leaderId", "user"],
    ["project_team_members", "projectId", "projects"],
    ["project_team_members", "userId", "user"],
    ["modules", "projectId", "projects"],
    ["features", "projectId", "projects"],
    ["features", "moduleId", "modules"],
    ["statuses", "projectId", "projects"],
    ["priorities", "projectId", "projects"],
    ["task_types", "projectId", "projects"],
    ["impacts", "projectId", "projects"],
    ["labels", "projectId", "projects"],
    ["tasks", "projectId", "projects"],
    ["tasks", "featureId", "features"],
    ["tasks", "statusId", "statuses"],
    ["tasks", "typeId", "task_types"],
    ["tasks", "impactId", "impacts"],
    ["checklists", "taskId", "tasks"],
    ["checklist_items", "checklistId", "checklists"],
    ["comments", "taskId", "tasks"],
    ["task_status_history", "taskId", "tasks"],
    ["invitations", "createdBy", "user"],
    ["invitations", "acceptedBy", "user"],
    ["invitation_projects", "invitationId", "invitations"],
    ["invitation_projects", "projectId", "projects"],
  ];
  for (const [table, key, parent] of references)
    for (const row of data[table])
      if (row[key] !== null && !has(parent, [row[key]])) invalid();
  const unique = (
    table: string,
    keys: string[],
    lower = false,
    skipNull = false,
  ) => {
    const seen = new Set<string>();
    for (const row of data[table]) {
      if (skipNull && keys.some((key) => row[key] === null)) continue;
      const value = JSON.stringify(
        keys.map((key) =>
          lower && key === "name" ? String(row[key]).toLowerCase() : row[key],
        ),
      );
      if (seen.has(value))
        invalid(
          "El respaldo contiene identificadores o valores únicos duplicados.",
        );
      seen.add(value);
    }
  };
  for (const name of Object.keys(backupTables)) {
    const relation = /^(project|module|feature|task)_(client|ticket)s$/.exec(name);
    if (relation) {
      unique(name, [`${relation[1]}Id`, `${relation[2]}Id`]);
      continue;
    }
    const keys =
      name === "task_team_members"
        ? ["taskId", "userId"]
        : name === "task_clients"
          ? ["taskId", "clientId"]
          : name === "priorities"
            ? ["id", "projectId"]
            : [
                  "project_team_members",
                  "module_team_members",
                  "feature_team_members",
                ].includes(name)
              ? [
                  name === "module_team_members"
                    ? "moduleId"
                    : name === "feature_team_members"
                      ? "featureId"
                      : "projectId",
                  "userId",
                ]
              : name === "invitation_projects"
                ? ["invitationId", "projectId"]
                : ["id"];
    unique(name, keys);
  }
  unique("user", ["email"]);
  unique("account", ["providerId", "accountId"]);
  unique("features", ["projectId", "moduleId", "number"]);
  unique("tasks", ["projectId", "externalId"], false, true);
  unique("checklists", ["taskId"]);
  unique("clients", ["normalizedName", "cityId"]);
  for (const department of data.departments)
    if (
      !/^\d{2}$/.test(String(department.id)) ||
      !String(department.name).trim()
    )
      invalid();
  for (const city of data.cities)
    if (
      !/^\d{5}$/.test(String(city.id)) ||
      !String(city.id).startsWith(String(city.departmentId)) ||
      !String(city.name).trim() ||
      !String(city.kind).trim()
    )
      invalid();
  for (const client of data.clients)
    if (
      !String(client.name).trim() ||
      String(client.name).length > 160 ||
      !normalizeClientText(String(client.name)) ||
      client.normalizedName !== normalizeClientText(String(client.name))
    )
      invalid();
  for (const name of [
    "statuses",
    "priorities",
    "task_types",
    "impacts",
    "labels",
  ])
    unique(name, ["projectId", "name"], true);
  const state = data.installation[0];
  if (
    data.installation.length !== 1 ||
    state.id !== 1 ||
    ![0, 1, 2].includes(Number(state.onboardingStep)) ||
    !data.user.some((row) => row.id === state.adminId && row.role === "admin")
  )
    invalid("El respaldo no contiene un administrador válido.");
  if (state.firstProjectId !== null && !has("projects", [state.firstProjectId]))
    invalid();
  for (const feature of data.features) {
    if (Number(feature.number) < 1) invalid();
    if (
      feature.moduleId !== null &&
      !has(
        "modules",
        [feature.moduleId, feature.projectId],
        ["id", "projectId"],
      )
    )
      invalid();
  }
  for (const task of data.tasks) {
    for (const [key, table] of [
      ["featureId", "features"],
      ["statusId", "statuses"],
      ["priority", "priorities"],
      ["typeId", "task_types"],
      ["impactId", "impacts"],
    ])
      if (
        task[key] !== null &&
        !has(table, [task[key], task.projectId], ["id", "projectId"])
      )
        invalid();
    for (const prefix of ["start", "due"]) {
      const date = task[`${prefix}Date`],
        time = task[`${prefix}Time`];
      if (
        date !== null &&
        (typeof date !== "string" ||
          !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
          !Number.isFinite(Date.parse(date)) ||
          new Date(date).toISOString().slice(0, 10) !== date)
      )
        invalid();
      if (
        time !== null &&
        (!date || !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(String(time)))
      )
        invalid();
    }
  }
  if (
    Number(state.maxAttachmentBytes) < 1048576 ||
    Number(state.maxAttachmentBytes) > 104857600
  )
    invalid();
  const isParticipant = (projectId: unknown, userId: unknown) =>
    data.user.some((u) => u.id === userId && u.role === "admin") ||
    data.projects.some((p) => p.id === projectId && p.leaderId === userId) ||
    data.project_team_members.some(
      (m) => m.projectId === projectId && m.userId === userId,
    );
  for (const row of [...data.modules, ...data.features])
    if (!isParticipant(row.projectId, row.leaderId)) invalid();
  for (const kind of ["module", "feature"])
    for (const member of data[`${kind}_team_members`]) {
      const entity = data[kind === "module" ? "modules" : "features"].find(
        (e) => e.id === member[`${kind}Id`],
      )!;
      if (
        !isParticipant(entity.projectId, member.userId) ||
        entity.leaderId === member.userId
      )
        invalid();
    }
  for (const task of data.tasks)
    if (!isParticipant(task.projectId, task.leaderId)) invalid();
  for (const c of data.task_team_members) {
    const task = data.tasks.find((t) => t.id === c.taskId)!;
    if (!isParticipant(task.projectId, c.userId) || task.leaderId === c.userId)
      invalid();
  }
  for (const row of [...data.comments, ...data.files, ...data.diagrams, ...data.documents]) {
    const targets = [row.taskId, row.moduleId, row.featureId].filter(
      (id) => id !== null,
    );
    if (row.scopeType === null) {
      if (data.comments.includes(row) || data.diagrams.includes(row) || data.documents.includes(row) || targets.length) invalid();
      continue;
    }
    const column = { task: "taskId", module: "moduleId", feature: "featureId" }[
      String(row.scopeType)
    ];
    if (row.scopeType === "project") {
      if (targets.length) invalid();
    } else if (!column || targets.length !== 1 || row[column] === null)
      invalid();
    if (column) {
      const parent = { task: "tasks", module: "modules", feature: "features" }[
        String(row.scopeType)
      ]!;
      if (!has(parent, [row[column], row.projectId], ["id", "projectId"]))
        invalid();
    }
  }
  for (const f of data.files) {
    if (
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
        String(f.id),
      ) ||
      f.storageKey !== f.id ||
      !["pending", "ready", "deleted"].includes(String(f.status)) ||
      !["file", "image"].includes(String(f.purpose)) ||
      Number(f.size) <= 0 ||
      Number(f.size) > 104857600
    )
      invalid();
    const extension = String(f.name).split(".").at(-1)!.toLowerCase();
    if (
      !fileTypes[extension] ||
      fileTypes[extension] !== f.mimeType ||
      (f.purpose === "image" && !String(f.mimeType).startsWith("image/")) ||
      !String(f.name).length ||
      String(f.name).length > 180 ||
      /[\\/\x00-\x1f\x7f]/.test(String(f.name)) ||
      (f.status !== "ready" && f.scopeType !== null)
    )
      invalid();
    if (
      f.taskId !== null &&
      !data.tasks.some((t) => t.id === f.taskId && t.projectId === f.projectId)
    )
      invalid();
  }
  return backup;
}

export async function exportApplicationBackup(
  store: DatabaseStore,
  destination: string,
) {
  const tables: Record<string, unknown[]> = {};
  await store.snapshot(async () => {
    for (const [name, table] of Object.entries(backupTables))
      tables[name] = await store.db.select().from(table);
    tables.diagrams = (tables.diagrams as Record<string, unknown>[]).map((row) => ({ ...row, publicToken: null }));
  });
  const text = JSON.stringify({
    format: "taskode-backup",
    version: 11,
    createdAt: new Date().toISOString(),
    tables,
  });
  if (Buffer.byteLength(text) > MAX_BACKUP_BYTES)
    throw new DomainError("El respaldo supera el límite de 100 MB.", 413);
  await writeFile(destination, text, { flag: "wx", mode: 0o600 });
}

export async function restoreApplicationBackup(
  store: DatabaseStore,
  source: string,
  beforeRestore?: () => Promise<void>,
) {
  const bytes = await readFile(source);
  if (!bytes.length || bytes.length > MAX_BACKUP_BYTES)
    throw new DomainError(
      "Adjunta un respaldo JSON de Taskode de hasta 100 MB.",
      413,
    );
  if (bytes.subarray(0, 16).toString().startsWith("SQLite format"))
    invalid(
      "Los respaldos SQLite anteriores no son compatibles con esta edición PostgreSQL.",
    );
  let input: unknown;
  try {
    input = JSON.parse(bytes.toString("utf8"));
  } catch {
    invalid("El archivo no contiene un respaldo JSON válido de Taskode.");
  }
  const backup = validateApplicationBackup(input);
  await store.restore(async () => {
    // The safety copy sees the state protected by the very same write lock.
    await beforeRestore?.();
    const names = [
      ...Object.keys(backupTables),
      "session",
      "verification",
      "comment_outbox",
      "notification_deliveries",
      "push_subscriptions",
      "task_reminders",
    ];
    await store.db.execute(
      sql`truncate table ${sql.join(
        names.map((name) => sql.identifier(name)),
        sql`, `,
      )} restart identity`,
    );
    for (const [name, table] of Object.entries(backupTables)) {
      const columns = getTableColumns(table as AnyPgTable);
      const rows = backup.tables[name];
      for (let offset = 0; offset < rows.length; offset += 500) {
        const values = rows
          .slice(offset, offset + 500)
          .map((row) =>
            Object.fromEntries(
              Object.entries(row).map(([key, value]) => [
                key,
                columns[key].dataType === "date" && value !== null
                  ? new Date(String(value))
                  : value,
              ]),
            ),
          );
        await store.db.insert(table as AnyPgTable).values(values);
      }
    }
    const history = await store.db.execute<{ last: number }>(
      sql`select coalesce(max(id), 0) as last from task_status_history`,
    );
    // RESTART is transactional; setval would survive a rollback.
    await store.db.execute(
      sql.raw(
        `alter table task_status_history alter column id restart with ${Number(history.rows[0].last) + 1}`,
      ),
    );
    await store.db
      .update(schema.invitations)
      .set({ revokedAt: Date.now() })
      .where(
        and(
          isNull(schema.invitations.acceptedAt),
          isNull(schema.invitations.revokedAt),
        ),
      );
    const sequence = await store.db.execute<{ last: string }>(sql`select coalesce(max(sequence), 0)::text as last from notifications`);
    await store.db.execute(sql.raw(`alter table notifications alter column sequence restart with ${BigInt(sequence.rows[0].last) + 1n}`));
    // Sessions and verification were cleared by TRUNCATE. No SQL, schema or
    // migration metadata is ever accepted from the uploaded document.
  });
}
