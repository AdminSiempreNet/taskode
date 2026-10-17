import { readFile, writeFile } from "node:fs/promises";
import { getTableColumns, sql, and, isNull } from "drizzle-orm";
import type { AnyPgTable } from "drizzle-orm/pg-core";
import { z } from "zod";
import * as schema from "./schema";
import type { DatabaseStore } from "./database";
import { DomainError } from "./repository";
import { MAX_BACKUP_BYTES } from "../lib/backups";

// The order also defines insertion order. Sessions, verification and migration
// metadata are deliberately not portable application data.
export const backupTables = {
  user: schema.user,
  account: schema.account,
  installation: schema.installation,
  projects: schema.projects,
  project_members: schema.projectMembers,
  modules: schema.modules,
  features: schema.features,
  statuses: schema.statuses,
  priorities: schema.priorities,
  task_types: schema.taskTypes,
  impacts: schema.impacts,
  labels: schema.labels,
  tasks: schema.tasks,
  checklists: schema.checklists,
  checklist_items: schema.checklistItems,
  comments: schema.comments,
  task_status_history: schema.taskStatusHistory,
  invitations: schema.invitations,
  invitation_projects: schema.invitationProjects,
};
type BackupRow = Record<string, string | number | boolean | string[] | null>;
const tableValidators: Record<string, z.ZodType> = {};
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
        field = z.array(z.string());
        break;
      default:
        field = column.enumValues?.length
          ? z.enum(column.enumValues as [string, ...string[]])
          : z.string();
    }
    fields[key] = column.notNull ? field : field.nullable();
  }
  tableValidators[name] = z.array(z.strictObject(fields));
}
const fileSchema = z.strictObject({
  // Existing backups remain restorable; all new exports use the Taskode format.
  format: z.enum(["taskode-backup", "brote-backup"]).transform(() => "taskode-backup" as const),
  version: z.literal(1),
  createdAt: z.iso.datetime(),
  tables: z.strictObject(tableValidators),
});
export type ApplicationBackup = {
  format: "taskode-backup";
  version: 1;
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
      "El archivo no es un respaldo JSON compatible de Taskode (versión 1).",
    );
  const backup = parsed.data as ApplicationBackup;
  const data = backup.tables;
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
    ["account", "userId", "user"],
    ["installation", "adminId", "user"],
    ["projects", "ownerId", "user"],
    ["project_members", "projectId", "projects"],
    ["project_members", "userId", "user"],
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
    const keys =
      name === "priorities"
        ? ["id", "projectId"]
        : name === "project_members"
          ? ["projectId", "userId"]
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
  });
  const text = JSON.stringify({
    format: "taskode-backup",
    version: 1,
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
    const names = [...Object.keys(backupTables), "session", "verification"];
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
    // Sessions and verification were cleared by TRUNCATE. No SQL, schema or
    // migration metadata is ever accepted from the uploaded document.
  });
}
