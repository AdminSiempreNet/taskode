import { stripTicketTables } from "./entity-fixtures";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { actor, addUser, createRepository } from "./helpers";
import {
  stripAssignmentColumns,
  removeAssignmentSchema,
} from "./entity-fixtures";
import { validateApplicationBackup } from "../src/server/backup-data";
import { commandSchema } from "../src/lib/validation";
import { migrationsFolder } from "../src/server/migration-info";
import journal from "../drizzle/postgresql/meta/_journal.json";

async function fixture() {
  const repo = await createRepository();
  const leader = await addUser(repo, "project-leader");
  const scopeLeader = await addUser(repo, "scope-leader");
  const member = await addUser(repo, "team-member");
  const outsider = await addUser(repo, "outsider");
  const projectId = (
    await repo.execute(
      {
        type: "project.create",
        name: "Proyecto",
        description: "",
        icon: "P",
        color: "#059669",
      },
      leader,
    )
  ).createdId!;
  await repo.execute(
    {
      type: "project.assignment.update",
      id: projectId,
      leaderId: leader.id,
      teamMemberIds: [scopeLeader.id, member.id],
    },
    leader,
  );
  const moduleId = (
    await repo.execute(
      { type: "module.create", projectId, name: "Módulo", description: "" },
      scopeLeader,
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
      scopeLeader,
    )
  ).createdId!;
  return {
    repo,
    leader,
    scopeLeader,
    member,
    outsider,
    projectId,
    moduleId,
    featureId,
  };
}

test("equipos propios: contenido y documentos sin gestión de usuarios, movimientos ni tareas privadas", async () => {
  const f = await fixture();
  try {
    for (const [kind, id] of [
      ["module", f.moduleId],
      ["feature", f.featureId],
    ] as const) {
      await assert.rejects(
        f.repo.execute(
          {
            type: `${kind}.assignment.update`,
            id,
            leaderId: f.scopeLeader.id,
            teamMemberIds: [f.outsider.id],
          },
          f.scopeLeader,
        ),
        { status: 404 },
      );
      await f.repo.execute(
        {
          type: `${kind}.assignment.update`,
          id,
          leaderId: f.scopeLeader.id,
          teamMemberIds: [f.member.id, f.member.id, f.scopeLeader.id],
        },
        f.scopeLeader,
      );
      const detail = await f.repo.entityDetail(f.member, kind, id);
      assert.deepEqual(detail.entity.teamMemberIds, [f.member.id]);
      assert.deepEqual(detail.permissions, {
        canEdit: true,
        canDelete: false,
        canManageAccess: false,
        canModerateComments: false,
        canComment: true,
        canManageFiles: true,
      });
      await f.repo.execute(
        { type: `${kind}.rename`, id, name: "Equipo edita" },
        f.member,
      );
      await f.repo.execute(
        kind === "feature"
          ? {
              type: "feature.update",
              id,
              name: "Feature",
              description: "Texto del equipo",
              moduleId: f.moduleId,
            }
          : {
              type: "module.update",
              id,
              name: "Módulo",
              description: "Texto del equipo",
            },
        f.member,
      );
      await assert.rejects(
        f.repo.execute({ type: `${kind}.delete`, id }, f.member),
        { status: 403 },
      );
      await assert.rejects(
        f.repo.execute(
          {
            type: `${kind}.assignment.update`,
            id,
            leaderId: f.member.id,
            teamMemberIds: [],
          },
          f.member,
        ),
        { status: 403 },
      );
      await assert.rejects(
        f.repo.execute(
          { type: `${kind}.leader.update`, id, userId: f.member.id },
          f.member,
        ),
        { status: 403 },
      );
    }
    await assert.rejects(
      f.repo.execute(
        {
          type: "feature.update",
          id: f.featureId,
          name: "Feature",
          description: "",
          moduleId: null,
        },
        f.member,
      ),
      { status: 403 },
    );
    const ws = await f.repo.getWorkspace(f.leader);
    const taskId = (
      await f.repo.execute(
        {
          type: "task.create",
          projectId: f.projectId,
          featureId: f.featureId,
          title: "Privada",
          description: "",
          statusId: ws.statuses[0].id,
          priority: "medium",
          dueDate: null,
          labels: [],
        },
        f.scopeLeader,
      )
    ).createdId!;
    await assert.rejects(f.repo.requireTask(f.member, taskId), { status: 404 });
    assert.equal((await f.repo.getWorkspace(f.member)).tasks.length, 0);
    // Membership is independent at each level.
    await f.repo.execute(
      {
        type: "feature.assignment.update",
        id: f.featureId,
        leaderId: f.scopeLeader.id,
        teamMemberIds: [],
      },
      f.leader,
    );
    assert.equal(
      (await f.repo.entityDetail(f.member, "feature", f.featureId)).permissions
        .canEdit,
      false,
    );
    assert.equal(
      (await f.repo.entityDetail(f.member, "module", f.moduleId)).permissions
        .canEdit,
      true,
    );
    await f.repo.execute(
      {
        type: "project.team.remove",
        projectId: f.projectId,
        userId: f.member.id,
      },
      f.leader,
    );
    await assert.rejects(f.repo.entityDetail(f.member, "module", f.moduleId), {
      status: 404,
    });
    assert.deepEqual(
      (await f.repo.entityDetail(f.leader, "module", f.moduleId)).entity
        .teamMemberIds,
      [],
    );
  } finally {
    await f.repo.close();
  }
});

test("proyecto: solo el administrador transfiere liderazgo; equipos se actualizan atómicamente", async () => {
  const f = await fixture();
  try {
    const before = await f.repo.getWorkspace(f.leader);
    await assert.rejects(
      f.repo.execute(
        {
          type: "project.assignment.update",
          id: f.projectId,
          leaderId: f.member.id,
          teamMemberIds: [],
        },
        f.leader,
      ),
      { status: 403 },
    );
    assert.deepEqual(await f.repo.getWorkspace(f.leader), before);
    await assert.rejects(
      f.repo.execute(
        {
          type: "project.assignment.update",
          id: f.projectId,
          leaderId: f.leader.id,
          teamMemberIds: [f.outsider.id],
        },
        f.leader,
      ),
      { status: 409 },
    );
    assert.deepEqual(await f.repo.getWorkspace(f.leader), before);
    await f.repo.execute(
      {
        type: "project.assignment.update",
        id: f.projectId,
        leaderId: f.member.id,
        teamMemberIds: [f.scopeLeader.id],
      },
      actor,
    );
    const project = (await f.repo.getWorkspace(f.leader)).projects[0];
    assert.equal(project.leaderId, f.member.id);
    assert.deepEqual(
      project.teamMemberIds?.sort(),
      [f.leader.id, f.scopeLeader.id].sort(),
    );
    assert.equal(Object.hasOwn(project, "ownerId"), false);
    assert.equal(
      (await f.repo.entityDetail(f.leader, "project", f.projectId)).permissions
        .canEdit,
      false,
    );
    assert.equal(
      (await f.repo.entityDetail(f.member, "project", f.projectId)).permissions
        .canManageAccess,
      true,
    );
  } finally {
    await f.repo.close();
  }
});

test("respaldo v6 conserva equipos y v5 conserva líderes y equipo de proyecto sin inventar asignaciones", async () => {
  const f = await fixture();
  const directory = await mkdtemp(join(tmpdir(), "taskode-assignment-backup-"));
  try {
    for (const [kind, id] of [
      ["module", f.moduleId],
      ["feature", f.featureId],
    ] as const)
      await f.repo.execute(
        {
          type: `${kind}.assignment.update`,
          id,
          leaderId: f.scopeLeader.id,
          teamMemberIds: [f.member.id],
        },
        f.leader,
      );
    const path = join(directory, "backup.json");
    await f.repo.exportBackup(path);
    const json = JSON.parse(await readFile(path, "utf8"));
    assert.equal(json.version, 11);
    const before = await f.repo.getWorkspace(f.leader);
    await f.repo.restoreBackup(path);
    assert.deepEqual(await f.repo.getWorkspace(f.leader), before);
    const invalid = structuredClone(json);
    invalid.tables.module_team_members[0].userId = f.outsider.id;
    assert.throws(() => validateApplicationBackup(invalid));
    stripAssignmentColumns(json.tables);
    stripTicketTables(json.tables);
    json.version = 5;
    const normalized = validateApplicationBackup(json);
    assert.equal(normalized.version, 11);
    assert.equal(normalized.tables.projects[0].leaderId, f.leader.id);
    assert.equal(normalized.tables.project_team_members.length, 2);
    assert.deepEqual(normalized.tables.module_team_members, []);
    await writeFile(path, JSON.stringify(json));
    await f.repo.restoreBackup(path);
    assert.deepEqual(
      (await f.repo.entityDetail(f.leader, "module", f.moduleId)).entity
        .teamMemberIds,
      [],
    );
    const invalidHistorical = structuredClone(json);
    invalidHistorical.tables.projects[0].leaderId = f.leader.id;
    assert.throws(() => validateApplicationBackup(invalidHistorical));
  } finally {
    await f.repo.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("migración 0006 conserva líderes, miembros y conversaciones existentes", async () => {
  const f = await fixture();
  try {
    await f.repo.execute(
      {
        type: "comment.create",
        scope: { kind: "module", id: f.moduleId, projectId: f.projectId },
        content: "Conservar",
      },
      f.member,
    );
    const before = await f.repo.getWorkspace(f.leader);
    await removeAssignmentSchema(f.repo);
    await f.repo.store.pool.query(
      "delete from __drizzle_migrations where created_at >= $1",
      [
        journal.entries.find(
          (entry) => entry.tag === "0006_entity_leaders_and_teams",
        )!.when,
      ],
    );
    await migrate(drizzle(f.repo.store.pool), {
      migrationsFolder: migrationsFolder(),
      migrationsSchema: f.repo.store.schemaName,
    });
    assert.deepEqual(await f.repo.getWorkspace(f.leader), before);
    assert.equal(
      (await f.repo.entityComments(f.member, "module", f.moduleId)).comments[0]
        .content,
      "Conservar",
    );
  } finally {
    await f.repo.close();
  }
});

test("los comandos anteriores de propiedad y participación se normalizan en el límite HTTP", () => {
  assert.deepEqual(
    commandSchema.parse({
      type: "project.member.add",
      projectId: "p",
      userId: "u",
    }),
    { type: "project.team.add", projectId: "p", userId: "u" },
  );
  for (const kind of ["project", "module", "feature"])
    assert.deepEqual(
      commandSchema.parse({
        type: `${kind}.transferOwnership`,
        id: "x",
        userId: "u",
      }),
      { type: `${kind}.leader.update`, id: "x", userId: "u" },
    );
});
