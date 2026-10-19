import { removeEntitySchema, stripEntityColumns } from "./entity-fixtures";
import { test } from "node:test";
import assert from "node:assert/strict";
import { actor, addUser, createRepository } from "./helpers";
import { matchesTaskFilters, MINE_FILTER } from "../src/lib/task-filters";
import { commandSchema } from "../src/lib/validation";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { migrationsFolder } from "../src/server/migration-info";
import { validateApplicationBackup } from "../src/server/backup-data";
import migrationJournal from "../drizzle/postgresql/meta/_journal.json";

async function fixture() {
  const repo = await createRepository();
  const owner = await addUser(repo, "owner"),
    moduleOwner = await addUser(repo, "module-owner"),
    featureOwner = await addUser(repo, "feature-owner"),
    leader = await addUser(repo, "leader"),
    teamMember = await addUser(repo, "teamMember"),
    author = await addUser(repo, "author"),
    other = await addUser(repo, "other");
  const projectId = (
    await repo.execute(
      {
        type: "project.create",
        name: "Privado",
        icon: "P",
        color: "#059669",
        description: "",
      },
      owner,
    )
  ).createdId!;
  for (const user of [
    moduleOwner,
    featureOwner,
    leader,
    teamMember,
    author,
    other,
  ])
    await repo.execute(
      { type: "project.team.add", projectId, userId: user.id },
      owner,
    );
  const moduleId = (
    await repo.execute(
      { type: "module.create", projectId, name: "Módulo", description: "" },
      moduleOwner,
    )
  ).createdId!;
  const featureId = (
    await repo.execute(
      {
        type: "feature.create",
        projectId,
        moduleId,
        name: "Feature",
        description: "",
      },
      featureOwner,
    )
  ).createdId!;
  const statusId = (await repo.getWorkspace(owner)).statuses[0].id;
  const fields = {
    projectId,
    featureId,
    statusId,
    title: "Confidencial",
    description: "",
    priority: "medium",
    dueDate: null,
    labels: [],
  };
  const taskId = (
    await repo.execute(
      {
        type: "task.create",
        ...fields,
        leaderId: leader.id,
        teamMemberIds: [teamMember.id, teamMember.id],
      },
      author,
    )
  ).createdId!;
  return {
    repo,
    owner,
    moduleOwner,
    featureOwner,
    leader,
    teamMember,
    author,
    other,
    projectId,
    moduleId,
    featureId,
    statusId,
    taskId,
    fields,
  };
}

test("tareas privadas: líder, miembro del equipo y propietarios reciben la tarea; autor y miembro ajeno no reciben datos derivados", async () => {
  const f = await fixture();
  const { repo, taskId } = f;
  try {
    await repo.execute(
      { type: "checklist.create", taskId, title: "Secreto" },
      f.leader,
    );
    await repo.execute(
      { type: "comment.create", taskId, content: "Mensaje privado" },
      f.teamMember,
    );
    for (const user of [
      actor,
      f.owner,
      f.moduleOwner,
      f.featureOwner,
      f.leader,
      f.teamMember,
    ]) {
      const task = (await repo.getWorkspace(user)).tasks.find(
        (t) => t.id === taskId,
      )!;
      assert.ok(task);
      assert.equal(task.comments[0].authorId, f.teamMember.id);
      assert.deepEqual(task.teamMemberIds, [f.teamMember.id]);
      assert.equal(
        task.permissions!.canManageAccess,
        user.id !== f.teamMember.id,
      );
    }
    for (const user of [f.author, f.other]) {
      assert.equal((await repo.getWorkspace(user)).tasks.length, 0);
      await assert.rejects(repo.taskComments(user, taskId), { status: 404 });
      await assert.rejects(
        repo.execute(
          { type: "comment.create", taskId, content: "Ataque" },
          user,
        ),
        { status: 404 },
      );
    }
  } finally {
    await repo.close();
  }
});

test("clientes: las asignaciones se guardan por separado, validan permisos y conservan las propiedades", async () => {
  const f = await fixture();
  const { repo, taskId } = f;
  try {
    const clientId = (
      await repo.execute(
        { type: "client.create", name: "Cliente compartido", cityId: "05001" },
        actor,
      )
    ).createdId!;
    const command = commandSchema.parse({
      type: "task.clients.update",
      id: taskId,
      clientIds: [clientId, clientId],
    });
    const before = (await repo.getWorkspace(f.leader)).tasks[0];
    await repo.execute(command, f.teamMember);
    const assigned = (await repo.getWorkspace(f.leader)).tasks[0];
    assert.deepEqual(assigned.clientIds, [clientId]);
    assert.deepEqual(
      { ...assigned, clientIds: [], updatedAt: before.updatedAt },
      before,
    );
    await assert.rejects(repo.execute(command, f.other), { status: 404 });
    await assert.rejects(
      repo.execute(
        { type: "task.clients.update", id: taskId, clientIds: ["missing"] },
        f.leader,
      ),
    );
    assert.deepEqual((await repo.getWorkspace(f.leader)).tasks[0], assigned);
    await repo.execute(
      { type: "task.update", ...f.fields, id: taskId, title: "Otra propiedad" },
      f.leader,
    );
    assert.deepEqual((await repo.getWorkspace(f.leader)).tasks[0].clientIds, [
      clientId,
    ]);
    await repo.execute(
      { type: "task.clients.update", id: taskId, clientIds: [] },
      f.teamMember,
    );
    const workspace = await repo.getWorkspace(f.leader);
    assert.deepEqual(workspace.tasks[0].clientIds, []);
    assert.equal(workspace.tasks[0].title, "Otra propiedad");
    const person = workspace.people?.find(
      (person) => person.id === f.teamMember.id,
    );
    assert.equal(person?.email, "teamMember@example.com");
    assert.equal(person?.name, "teamMember");
    assert.equal(person?.image, null);
    assert.equal(
      workspace.people?.some((person) => person.id === "outsider"),
      false,
    );
  } finally {
    await repo.close();
  }
});

test("colaboración limitada, autoría de mensajes, transferencias y retirada de miembros se validan en el servidor", async () => {
  const f = await fixture();
  const { repo, taskId } = f;
  try {
    await repo.execute(
      { type: "task.rename", id: taskId, title: "Colaboración" },
      f.teamMember,
    );
    await repo.execute(
      { type: "task.archive", id: taskId, archived: true },
      f.teamMember,
    );
    const listId = (
      await repo.execute(
        { type: "checklist.create", taskId, title: "Lista" },
        f.leader,
      )
    ).createdId!;
    await assert.rejects(
      repo.execute(
        { type: "checklist.item.create", checklistId: listId, title: "Ataque" },
        f.other,
      ),
      { status: 404 },
    );
    for (const command of [
      { type: "task.delete", id: taskId },
      {
        type: "task.assignment.update",
        id: taskId,
        leaderId: f.teamMember.id,
        teamMemberIds: [],
      },
      { type: "feature.delete", id: f.featureId },
      { type: "module.delete", id: f.moduleId },
    ])
      await assert.rejects(
        repo.execute(commandSchema.parse(command), f.teamMember),
        { status: 403 },
      );
    const note = (
      await repo.execute(
        { type: "comment.create", taskId, content: "Mío" },
        f.teamMember,
      )
    ).createdId!;
    await assert.rejects(
      repo.execute(
        { type: "comment.update", id: note, content: "Ajeno" },
        f.leader,
      ),
      { status: 403 },
    );
    await repo.execute(
      { type: "comment.update", id: note, content: "Editado" },
      f.teamMember,
    );
    await repo.execute({ type: "comment.delete", id: note }, f.featureOwner);
    for (const user of [f.leader, f.moduleOwner, f.featureOwner])
      await assert.rejects(
        repo.execute(
          {
            type: "project.team.remove",
            projectId: f.projectId,
            userId: user.id,
          },
          f.owner,
        ),
        { status: 409 },
      );
    await repo.execute(
      {
        type: "project.team.remove",
        projectId: f.projectId,
        userId: f.teamMember.id,
      },
      f.owner,
    );
    await assert.rejects(repo.requireTask(f.teamMember, taskId), {
      status: 404,
    });
    assert.deepEqual(
      (await repo.getWorkspace(f.owner)).tasks[0].teamMemberIds,
      [],
    );
    await repo.execute(
      { type: "module.leader.update", id: f.moduleId, userId: f.other.id },
      f.moduleOwner,
    );
    assert.equal((await repo.getWorkspace(f.moduleOwner)).tasks.length, 0);
    assert.equal((await repo.getWorkspace(f.other)).tasks.length, 1);
    const outsider = await addUser(repo, "outsider");
    await assert.rejects(
      repo.execute(
        {
          type: "task.assignment.update",
          id: taskId,
          leaderId: outsider.id,
          teamMemberIds: [],
        },
        f.owner,
      ),
      { status: 404 },
    );
  } finally {
    await repo.close();
  }
});

test("solo administrador configura el límite; respaldos v4 y v3 conservan líder y equipo y v2 migra sin inventar autoría", async () => {
  const f = await fixture();
  const directory = await mkdtemp(join(tmpdir(), "taskode-sharing-"));
  try {
    await assert.rejects(
      f.repo.execute(
        { type: "settings.update", maxAttachmentBytes: 2097152 },
        f.owner,
      ),
      { status: 403 },
    );
    await f.repo.execute(
      { type: "settings.update", maxAttachmentBytes: 2097152 },
      actor,
    );
    const path = join(directory, "v4.json");
    await f.repo.exportBackup(path);
    const backup = JSON.parse(await readFile(path, "utf8"));
    assert.equal(backup.version, 10);
    assert.equal(backup.tables.tasks[0].leaderId, f.leader.id);
    assert.equal(backup.tables.tasks[0].assigneeId, undefined);
    assert.deepEqual(backup.tables.task_team_members, [
      { taskId: f.taskId, userId: f.teamMember.id },
    ]);
    assert.equal(backup.tables.task_collaborators, undefined);
    await f.repo.restoreBackup(path);
    assert.equal(
      (await f.repo.getWorkspace(f.leader)).settings!.maxAttachmentBytes,
      2097152,
    );
    assert.deepEqual(
      (await f.repo.getWorkspace(f.leader)).tasks[0].teamMemberIds,
      [f.teamMember.id],
    );
    const before = await f.repo.getWorkspace(f.leader);
    for (const format of ["taskode-backup", "brote-backup"]) {
      const version3 = structuredClone(backup);
      stripEntityColumns(version3.tables);
      version3.format = format;
      version3.version = 3;
      version3.tables.tasks = version3.tables.tasks.map(
        ({ leaderId, ...task }: Record<string, unknown>) => ({
          ...task,
          assigneeId: leaderId,
        }),
      );
      version3.tables.task_collaborators = version3.tables.task_team_members;
      delete version3.tables.task_team_members;
      const normalized = validateApplicationBackup(version3);
      assert.equal(normalized.version, 10);
      assert.deepEqual(normalized.tables, { ...backup.tables, notifications: [], notification_preferences: [] });
      const path = join(directory, `${format}-v3.json`);
      await writeFile(path, JSON.stringify(version3));
      await f.repo.restoreBackup(path);
      assert.deepEqual(await f.repo.getWorkspace(f.leader), before);
      const invalidTeam = structuredClone(version3);
      invalidTeam.tables.task_collaborators[0].userId = "unknown";
      assert.throws(() => validateApplicationBackup(invalidTeam));
      const invalidLeader = structuredClone(version3);
      invalidLeader.tables.tasks[0].assigneeId = "unknown";
      assert.throws(() => validateApplicationBackup(invalidLeader));
    }
    stripEntityColumns(backup.tables);
    backup.version = 2;
    delete backup.tables.task_team_members;
    delete backup.tables.files;
    for (const r of backup.tables.installation) delete r.maxAttachmentBytes;
    for (const t of ["modules", "features"])
      for (const r of backup.tables[t]) delete r.ownerId;
    for (const r of backup.tables.tasks) {
      delete r.createdById;
      delete r.leaderId;
    }
    for (const r of backup.tables.comments) delete r.authorId;
    const legacy = join(directory, "v2.json");
    await writeFile(legacy, JSON.stringify(backup));
    await f.repo.restoreBackup(legacy);
    const task = (await f.repo.getWorkspace(f.owner)).tasks[0];
    assert.equal(task.leaderId, f.owner.id);
    assert.equal(task.createdById, null);
    assert.deepEqual(task.teamMemberIds, []);
    assert.equal((await f.repo.getWorkspace(f.leader)).tasks.length, 0);
  } finally {
    await f.repo.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("migración de líder y equipo renombra tablas, columnas y restricciones sin perder datos ni permisos", async () => {
  const f = await fixture();
  const { repo } = f;
  try {
    await repo.execute(
      { type: "comment.create", taskId: f.taskId, content: "Conservar" },
      f.teamMember,
    );
    const users = [f.owner, f.leader, f.teamMember, f.other];
    const before = await Promise.all(
      users.map((user) => repo.getWorkspace(user)),
    );
    // Recreate migration 0002's names inside this fixture's disposable schema.
    await repo.store.pool.query(
      "drop trigger taskode_comment_changed on comments; drop function taskode_queue_comment_change(); drop table comment_outbox",
    );
    await removeEntitySchema(repo);
    await repo.store.pool.query(`
      alter table tasks rename column "leaderId" to "assigneeId";
      alter table tasks rename constraint "tasks_leaderId_user_id_fk" to "tasks_assigneeId_user_id_fk";
      alter table task_team_members rename to task_collaborators;
      alter table task_collaborators rename constraint "task_team_members_taskId_userId_pk" to "task_collaborators_taskId_userId_pk";
      alter table task_collaborators rename constraint "task_team_members_taskId_tasks_id_fk" to "task_collaborators_taskId_tasks_id_fk";
      alter table task_collaborators rename constraint "task_team_members_userId_user_id_fk" to "task_collaborators_userId_user_id_fk";
      alter index team_member_user rename to collaborator_user;
      do $$ begin
        if exists (select 1 from pg_constraint where conrelid = 'tasks'::regclass and conname = 'tasks_leaderId_not_null') then
          alter table tasks rename constraint "tasks_leaderId_not_null" to "tasks_assigneeId_not_null";
        end if;
        if exists (select 1 from pg_constraint where conrelid = 'task_collaborators'::regclass and conname = 'task_team_members_taskId_not_null') then
          alter table task_collaborators rename constraint "task_team_members_taskId_not_null" to "task_collaborators_taskId_not_null";
        end if;
        if exists (select 1 from pg_constraint where conrelid = 'task_collaborators'::regclass and conname = 'task_team_members_userId_not_null') then
          alter table task_collaborators rename constraint "task_team_members_userId_not_null" to "task_collaborators_userId_not_null";
        end if;
      end $$;
    `);
    await repo.store.pool.query(
      "delete from __drizzle_migrations where created_at >= $1",
      [
        migrationJournal.entries.find(
          (entry) => entry.tag === "0003_task_leader_and_team",
        )!.when,
      ],
    );
    const options = {
      migrationsFolder: migrationsFolder(),
      migrationsSchema: repo.store.schemaName,
    };
    await migrate(drizzle(repo.store.pool), options);
    await migrate(drizzle(repo.store.pool), options);
    assert.deepEqual(
      await Promise.all(users.map((user) => repo.getWorkspace(user))),
      before,
    );
    const tables = await repo.store.pool.query(
      "select table_name from information_schema.tables where table_schema = $1 and table_name in ('task_team_members', 'task_collaborators')",
      [repo.store.schemaName],
    );
    assert.deepEqual(tables.rows, [{ table_name: "task_team_members" }]);
    const columns = await repo.store.pool.query(
      "select column_name from information_schema.columns where table_schema = $1 and table_name = 'tasks' and column_name in ('leaderId', 'assigneeId')",
      [repo.store.schemaName],
    );
    assert.deepEqual(columns.rows, [{ column_name: "leaderId" }]);
    const oldNames = await repo.store.pool.query(
      "select conname from pg_constraint where connamespace = $1::regnamespace and (conname like '%assignee%' or conname like '%collaborator%')",
      [repo.store.schemaName],
    );
    assert.deepEqual(oldNames.rows, []);
    await repo.execute(
      {
        type: "task.assignment.update",
        id: f.taskId,
        leaderId: f.leader.id,
        teamMemberIds: [],
      },
      f.owner,
    );
    assert.equal((await repo.getWorkspace(f.teamMember)).tasks.length, 0);
  } finally {
    await repo.close();
  }
});

test("las solicitudes anteriores se normalizan a líder y equipo antes de validar permisos", () => {
  assert.deepEqual(
    commandSchema.parse({
      type: "task.participants.update",
      id: "task",
      assigneeId: "leader",
      collaboratorIds: ["member"],
    }),
    {
      type: "task.assignment.update",
      id: "task",
      leaderId: "leader",
      teamMemberIds: ["member"],
    },
  );
});

test("filtro de usuarios combina Mías, líderes y miembros del equipo con las demás categorías", () => {
  const task = {
    statusId: "s",
    typeId: null,
    impactId: null,
    leaderId: "a",
    teamMemberIds: ["b"],
  };
  const filters = {
    statusIds: [],
    typeIds: [],
    impactIds: [],
    currentUserId: "b",
    userIds: [MINE_FILTER],
  };
  assert.equal(matchesTaskFilters(task, filters), true);
  assert.equal(
    matchesTaskFilters(task, { ...filters, currentUserId: "c" }),
    false,
  );
  assert.equal(
    matchesTaskFilters(task, { ...filters, userIds: ["c", "a"] }),
    true,
  );
  assert.equal(matchesTaskFilters(task, { ...filters, userIds: [] }), true);
  assert.equal(
    matchesTaskFilters(task, { ...filters, statusIds: ["other"] }),
    false,
  );
});
