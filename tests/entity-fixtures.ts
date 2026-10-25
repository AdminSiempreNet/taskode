import type { PostgresRepository } from "../src/server/postgres";

// Catalogs introduced after a historical schema are seeded with fresh identities.
// Compare their names, properties and associations without assuming old ids existed.
export function normalizeApplicationIdentity<T>(value: T): T {
  const aliases = new Map<string, string>();
  const collect = (item: unknown) => {
    if (!item || typeof item !== "object") return;
    const object = item as Record<string, unknown>;
    if (Array.isArray(object.applications)) for (const app of object.applications)
      aliases.set(app.id, `${app.projectId}:${app.name}`);
    for (const child of Object.values(object)) collect(child);
  };
  collect(value);
  const convert = (item: unknown): unknown => {
    if (typeof item === "string") return aliases.get(item) ?? item;
    if (Array.isArray(item)) return item.map(convert);
    if (item && typeof item === "object") return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, convert(child)]));
    return item;
  };
  return convert(value) as T;
}

// Restore the pre-0005 shape only inside disposable test schemas before replaying migrations.
export async function removeEntitySchema(repo: PostgresRepository) {
  if (!/^taskode_test_[a-f0-9]{32}$/.test(repo.store.schemaName))
    throw new Error("Esquema de prueba inválido.");
  await removeAssignmentSchema(repo);
  await repo.store.pool.query(`
    alter table comments drop column "projectId", drop column "scopeType", drop column "moduleId", drop column "featureId";
    alter table comments alter column "taskId" set not null;
    alter table comments add constraint "comments_taskId_tasks_id_fk" foreign key ("taskId") references tasks(id) on delete cascade;
    alter table files drop constraint "files_taskId_projectId_tasks_id_projectId_fk";
    alter table files drop column "scopeType", drop column "moduleId", drop column "featureId";
    drop index module_identity;
    drop index task_identity;
  `);
}

export function stripEntityColumns(
  tables: Record<string, Record<string, unknown>[]>,
) {
  stripAssignmentColumns(tables);
  for (const name of ["comments", "files"])
    for (const row of tables[name] ?? []) {
      delete row.scopeType;
      delete row.moduleId;
      delete row.featureId;
      if (name === "comments") delete row.projectId;
    }
}

// Historical JSON and schema adapters are intentionally separate from canonical application code.
export function stripAssignmentColumns(
  tables: Record<string, Record<string, unknown>[]>,
) {
  stripTicketTables(tables);
  delete tables.documents;
  delete tables.diagrams;
  delete tables.notification_preferences;
  delete tables.notifications;
  for (const project of tables.projects ?? []) delete project.timeZone;
  if (!tables.project_team_members) return;
  tables.project_members = tables.project_team_members;
  delete tables.project_team_members;
  delete tables.module_team_members;
  delete tables.feature_team_members;
  for (const name of ["projects", "modules", "features"])
    for (const row of tables[name]) {
      row.ownerId = row.leaderId;
      delete row.leaderId;
    }
}
export async function removeAssignmentSchema(repo: PostgresRepository) {
  if (!/^taskode_test_[a-f0-9]{32}$/.test(repo.store.schemaName))
    throw new Error("Esquema de prueba inválido.");
  await removeTicketSchema(repo);
  await repo.store.pool.query(`drop table if exists documents, diagrams, notification_deliveries, push_subscriptions, task_reminders, notifications, notification_preferences; alter table projects drop column if exists "timeZone";`);
  await repo.store.pool.query(
    "drop table module_team_members, feature_team_members",
  );
  for (const table of ["projects", "modules", "features"])
    await repo.store.pool.query(`
    alter table "${table}" rename column "leaderId" to "ownerId";
    alter table "${table}" rename constraint "${table}_leaderId_user_id_fk" to "${table}_ownerId_user_id_fk";
    do $$ begin if exists (select 1 from pg_constraint where conrelid = '${table}'::regclass and conname = '${table}_leaderId_not_null') then
      alter table "${table}" rename constraint "${table}_leaderId_not_null" to "${table}_ownerId_not_null"; end if; end $$;
  `);
  await repo.store.pool.query(
    "alter index project_leader rename to project_owner; alter index project_team_user rename to membership_user; alter table project_team_members rename to project_members",
  );
  for (const suffix of [
    "projectId_userId_pk",
    "projectId_projects_id_fk",
    "userId_user_id_fk",
  ])
    await repo.store.pool.query(
      `alter table project_members rename constraint "project_team_members_${suffix}" to "project_members_${suffix}"`,
    );
  for (const column of ["projectId", "userId"])
    await repo.store.pool.query(
      `do $$ begin if exists (select 1 from pg_constraint where conrelid = 'project_members'::regclass and conname = 'project_team_members_${column}_not_null') then alter table project_members rename constraint "project_team_members_${column}_not_null" to "project_members_${column}_not_null"; end if; end $$;`,
    );
}

export const ticketTables = ["tickets", "project_clients", "module_clients", "feature_clients", "project_tickets", "module_tickets", "feature_tickets", "task_tickets"];

export function stripApplicationTables(tables: Record<string, Record<string, unknown>[]>) {
  for (const name of ["applications", "module_applications", "feature_applications", "task_applications"]) delete tables[name];
}

export function stripTicketTables(tables: Record<string, Record<string, unknown>[]>) {
  stripApplicationTables(tables);
  // Account/access notifications were introduced after all historical fixtures.
  if (tables.notifications) tables.notifications = tables.notifications.filter(n => n.scopeType !== "account");
  if (!tables.tickets) return;
  for (const task of tables.tasks) {
    const link = tables.task_tickets.find((link) => link.taskId === task.id);
    task.ticketNumber = tables.tickets.find((ticket) => ticket.id === link?.ticketId)?.number ?? null;
  }
  for (const name of ticketTables) delete tables[name];
}

// 0014: OAuth/MCP tables are additive and independent of earlier migrations.
export async function removeOAuthSchema(repo: PostgresRepository) {
  if (!/^taskode_test_[a-f0-9]{32}$/.test(repo.store.schemaName)) throw new Error("Esquema de prueba inválido.");
  // 0016: the board's realtime queue and its triggers on tasks.
  await repo.store.pool.query(
    "drop trigger if exists taskode_task_written on tasks; drop trigger if exists taskode_task_updated on tasks; drop function if exists taskode_queue_workspace_change(); drop table if exists workspace_outbox",
  );
  await repo.store.pool.query("drop table if exists task_applications, feature_applications, module_applications, applications");
  await repo.store.pool.query(
    "drop table if exists oauth_access_token, oauth_refresh_token, oauth_consent, oauth_client_resource, oauth_client, oauth_resource, oauth_client_assertion, jwks, mcp_activity",
  );
}
export async function removeTicketSchema(repo: PostgresRepository) {
  if (!/^taskode_test_[a-f0-9]{32}$/.test(repo.store.schemaName)) throw new Error("Esquema de prueba inválido.");
  await removeOAuthSchema(repo);
  await repo.store.pool.query(`drop table project_clients, module_clients, feature_clients, project_tickets, module_tickets, feature_tickets, task_tickets, tickets; alter table tasks add column "ticketNumber" text`);
}
