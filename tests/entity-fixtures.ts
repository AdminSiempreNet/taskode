import type { PostgresRepository } from "../src/server/postgres";

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
  await repo.store.pool.query(`drop table if exists diagrams, notification_deliveries, push_subscriptions, task_reminders, notifications, notification_preferences; alter table projects drop column if exists "timeZone";`);
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
