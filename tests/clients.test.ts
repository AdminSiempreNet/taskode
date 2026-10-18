import { removeEntitySchema, stripEntityColumns } from "./entity-fixtures";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { actor, addUser, createRepository, assertIntegrity } from "./helpers";
import { PostgresRepository } from "../src/server/postgres";
import { commandSchema, type Command } from "../src/lib/validation";
import { normalizeClientText } from "../src/lib/clients";
import { validateApplicationBackup } from "../src/server/backup-data";
import { migrationsFolder } from "../src/server/migration-info";
import { expectedMigration } from "../src/server/migration-info";
import divipola from "../src/server/catalogs/divipola.json";

async function createTaskCommand(
  repo: PostgresRepository,
): Promise<Extract<Command, { type: "task.create" }>> {
  const { createdId: projectId } = await repo.execute(
    {
      type: "project.create",
      name: "Proyecto privado",
      description: "",
      icon: "📋",
      color: "#059669",
    },
    actor,
  );
  const workspace = await repo.getWorkspace(actor);
  return {
    type: "task.create",
    projectId: projectId!,
    featureId: workspace.features[0].id,
    statusId: workspace.statuses[0].id,
    title: "Tarea",
    description: "Borrador",
    priority: "medium",
    dueDate: null,
    labels: [],
  };
}

test("DIVIPOLA conserva códigos, ubicación especial y catálogo completo al repetir migraciones", async () => {
  const repo = await createRepository();
  try {
    const geography = await repo.getGeography(actor);
    assert.equal(geography.departments.length, divipola.departmentCount);
    assert.equal(geography.cities.length, divipola.cityCount);
    assert.equal(
      geography.cities.find((city) => city.id === "05001")?.name,
      "MEDELLÍN",
    );
    assert.equal(
      geography.cities.find((city) => city.id === "11001")?.departmentId,
      "11",
    );
    assert.ok(geography.cities.some((city) => city.kind === "Isla"));
    assert.ok(
      geography.cities.some((city) => city.kind === "Área no municipalizada"),
    );
    await migrate(drizzle(repo.store.pool), {
      migrationsFolder: migrationsFolder(),
      migrationsSchema: repo.store.schemaName,
    });
    assert.deepEqual(await repo.getGeography(actor), geography);
    await assert.rejects(repo.getGeography({ id: "unknown" }), { status: 401 });
    await assertIntegrity(repo);
  } finally {
    await repo.close();
  }
});

test("clientes globales: ambos roles gestionan sin proyectos, unicidad normalizada y ciudad obligatoria", async () => {
  const repo = await createRepository();
  try {
    const member = await addUser(repo, "member");
    assert.equal((await repo.getWorkspace(member)).projects.length, 0);
    for (const command of [
      { type: "client.create", name: " ", cityId: "05001" },
      { type: "client.create", name: "Nombre" },
    ])
      assert.equal(commandSchema.safeParse(command).success, false);
    await assert.rejects(
      repo.execute(
        { type: "client.create", name: "Nombre", cityId: "bad" },
        member,
      ),
      /ciudad válida/,
    );
    const { createdId: id } = await repo.execute(
      { type: "client.create", name: "  Café   Águila  ", cityId: "05001" },
      member,
    );
    const client = (await repo.getWorkspace(actor)).clients[0];
    assert.equal(client.id, id);
    assert.equal(client.name, "Café Águila");
    assert.equal(client.departmentName, "ANTIOQUIA");
    assert.equal(client.cityName, "MEDELLÍN");
    assert.ok(!("normalizedName" in client));
    await assert.rejects(
      repo.execute(
        { type: "client.create", name: "CAFE AGUILA", cityId: "05001" },
        actor,
      ),
      { status: 409 },
    );
    const second = await repo.execute(
      { type: "client.create", name: "CAFE AGUILA", cityId: "11001" },
      actor,
    );
    await assert.rejects(
      repo.execute(
        {
          type: "client.update",
          id: second.createdId!,
          name: "Café águila",
          cityId: "05001",
        },
        member,
      ),
      { status: 409 },
    );
    await repo.execute(
      { type: "client.update", id: id!, name: "Nuevo nombre", cityId: "11001" },
      member,
    );
    assert.equal(
      (await repo.getWorkspace(actor)).clients.find(
        (client) => client.id === id,
      )?.departmentId,
      "11",
    );
    await repo.execute({ type: "client.delete", id: id! }, member);
    await repo.execute({ type: "client.delete", id: second.createdId! }, actor);
    assert.deepEqual((await repo.getWorkspace(member)).clients, []);
    await assert.rejects(
      repo.execute(
        { type: "client.create", name: "Nombre", cityId: "05001" },
        { id: "unknown" },
      ),
      { status: 401 },
    );
    assert.equal(
      normalizeClientText("  ÁCME\t del   Norte "),
      "acme del norte",
    );
  } finally {
    await repo.close();
  }
});

test("la migración aditiva actualiza el esquema anterior conservando proyectos y tareas", async () => {
  const repo = await createRepository();
  try {
    const command = await createTaskCommand(repo);
    await repo.execute(command, actor);
    const before = await repo.getWorkspace(actor);
    // All operations stay inside this fixture's disposable schema. Removing only
    // the additive tables reproduces the schema of migration 0000 with live data.
    await repo.store.pool.query(
      "drop trigger taskode_comment_changed on comments; drop function taskode_queue_comment_change(); drop table comment_outbox",
    );
    await removeEntitySchema(repo);
    await repo.store.pool.query(
      "drop table files, task_team_members, task_clients, clients, cities, departments",
    );
    await repo.store.pool.query(
      'alter table modules drop column "ownerId"; alter table features drop column "ownerId"; alter table tasks drop column "createdById", drop column "leaderId"; alter table comments drop column "authorId"; alter table installation drop column "maxAttachmentBytes"',
    );
    await repo.store.pool.query(
      "delete from __drizzle_migrations where created_at > (select min(created_at) from __drizzle_migrations)",
    );
    before.tasks.forEach((t) => {
      t.createdById = null;
    });
    await migrate(drizzle(repo.store.pool), {
      migrationsFolder: migrationsFolder(),
      migrationsSchema: repo.store.schemaName,
    });
    assert.deepEqual(await repo.getWorkspace(actor), before);
    assert.equal(
      (await repo.getGeography(actor)).cities.length,
      divipola.cityCount,
    );
    await assertIntegrity(repo);
  } finally {
    await repo.close();
  }
});

test("tareas: cero o varios clientes, permisos por proyecto, actualizaciones compatibles y borrado restringido", async () => {
  const repo = await createRepository();
  try {
    const member = await addUser(repo, "member");
    const one = (
      await repo.execute(
        { type: "client.create", name: "Uno", cityId: "05001" },
        member,
      )
    ).createdId!;
    const two = (
      await repo.execute(
        { type: "client.create", name: "Dos", cityId: "11001" },
        actor,
      )
    ).createdId!;
    const command = await createTaskCommand(repo);
    const id = (await repo.execute(command, actor)).createdId!;
    assert.deepEqual((await repo.getWorkspace(actor)).tasks[0].clientIds, []);
    await repo.execute(
      { ...command, type: "task.update", id, clientIds: [one, two, one] },
      actor,
    );
    assert.deepEqual(
      (await repo.getWorkspace(actor)).tasks[0].clientIds,
      [one, two].sort(),
    );
    await repo.execute(
      { ...command, type: "task.update", id, title: "Edición anterior" },
      actor,
    );
    assert.deepEqual(
      (await repo.getWorkspace(actor)).tasks[0].clientIds,
      [one, two].sort(),
    );
    const before = await repo.getWorkspace(actor);
    await assert.rejects(
      repo.execute(
        {
          ...command,
          type: "task.update",
          id,
          title: "No guardar",
          clientIds: ["missing"],
        },
        actor,
      ),
    );
    assert.deepEqual(await repo.getWorkspace(actor), before);
    await assert.rejects(
      repo.execute(
        { ...command, type: "task.update", id, clientIds: [] },
        member,
      ),
      { status: 404 },
    );
    assert.deepEqual((await repo.getWorkspace(member)).tasks, []);
    await repo.execute({ type: "task.archive", id, archived: true }, actor);
    await assert.rejects(
      repo.execute({ type: "client.delete", id: one }, member),
      { status: 409 },
    );
    await repo.execute(
      { ...command, type: "task.update", id, clientIds: [] },
      actor,
    );
    await repo.execute({ type: "client.delete", id: one }, member);
    await repo.execute(
      { ...command, type: "task.update", id, clientIds: [two] },
      actor,
    );
    await repo.execute({ type: "task.delete", id }, actor);
    await repo.execute({ type: "client.delete", id: two }, member);
    await assertIntegrity(repo);
  } finally {
    await repo.close();
  }
});

test("dos instancias coordinan duplicados y asociación frente a eliminación sin referencias huérfanas", async () => {
  const repo = await createRepository();
  const peer = new PostgresRepository(repo.store.connectionString, {
    schema: repo.store.schemaName,
  });
  try {
    const created = await Promise.allSettled([
      repo.execute(
        { type: "client.create", name: "Compañía", cityId: "05001" },
        actor,
      ),
      peer.execute(
        { type: "client.create", name: "COMPANIA", cityId: "05001" },
        actor,
      ),
    ]);
    assert.equal(
      created.filter((result) => result.status === "fulfilled").length,
      1,
    );
    const clientId = (await repo.getWorkspace(actor)).clients[0].id;
    const command = await createTaskCommand(repo);
    const results = await Promise.allSettled([
      repo.execute({ ...command, clientIds: [clientId] }, actor),
      peer.execute({ type: "client.delete", id: clientId }, actor),
    ]);
    assert.equal(
      results.filter((result) => result.status === "fulfilled").length,
      1,
    );
    const workspace = await peer.getWorkspace(actor);
    for (const task of workspace.tasks)
      for (const id of task.clientIds)
        assert.ok(workspace.clients.some((client) => client.id === id));
    await assertIntegrity(repo);
  } finally {
    await peer.close();
    await repo.close();
  }
});

test("respaldos v2 conservan clientes y relaciones; v1 Taskode y Brote restauran con geografía", async () => {
  const repo = await createRepository();
  const directory = await mkdtemp(join(tmpdir(), "taskode-clients-"));
  try {
    const clientId = (
      await repo.execute(
        { type: "client.create", name: "Cliente", cityId: "05001" },
        actor,
      )
    ).createdId!;
    const command = await createTaskCommand(repo);
    await repo.execute({ ...command, clientIds: [clientId] }, actor);
    const snapshot = await repo.getWorkspace(actor);
    const path = join(directory, "backup.json");
    await repo.exportBackup(path);
    const file = JSON.parse(await readFile(path, "utf8"));
    assert.equal(file.version, 6);
    validateApplicationBackup(file);
    for (const mutate of [
      (copy: typeof file) => {
        delete copy.tables.clients;
      },
      (copy: typeof file) => {
        copy.tables.clients[0].cityId = "missing";
      },
      (copy: typeof file) => {
        copy.tables.clients[0].normalizedName = "wrong";
      },
      (copy: typeof file) => {
        copy.tables.clients.push({
          ...copy.tables.clients[0],
          id: "duplicate",
        });
      },
      (copy: typeof file) => {
        copy.tables.task_clients[0].clientId = "missing";
      },
      (copy: typeof file) => {
        copy.tables.task_clients.push({ ...copy.tables.task_clients[0] });
      },
      (copy: typeof file) => {
        copy.tables.cities[0].departmentId = "missing";
      },
    ]) {
      const copy = structuredClone(file);
      mutate(copy);
      assert.throws(() => validateApplicationBackup(copy));
    }
    await repo.execute(
      { type: "project.delete", id: command.projectId },
      actor,
    );
    await repo.execute({ type: "client.delete", id: clientId }, actor);
    await repo.restoreBackup(path);
    assert.deepEqual(await repo.getWorkspace(actor), snapshot);
    for (const format of ["taskode-backup", "brote-backup"]) {
      const legacy = structuredClone(file);
      stripEntityColumns(legacy.tables);
      legacy.format = format;
      legacy.version = 1;
      delete legacy.tables.files;
      delete legacy.tables.task_team_members;
      legacy.tables.installation.forEach((r: Record<string, unknown>) => {
        delete r.maxAttachmentBytes;
      });
      for (const table of ["modules", "features"])
        legacy.tables[table].forEach((r: Record<string, unknown>) => {
          delete r.ownerId;
        });
      legacy.tables.tasks.forEach((r: Record<string, unknown>) => {
        delete r.createdById;
        delete r.leaderId;
      });
      legacy.tables.comments.forEach((r: Record<string, unknown>) => {
        delete r.authorId;
      });
      for (const name of ["departments", "cities", "clients", "task_clients"])
        delete legacy.tables[name];
      const legacyPath = join(directory, `${format}.json`);
      await writeFile(legacyPath, JSON.stringify(legacy));
      await repo.restoreBackup(legacyPath);
      assert.deepEqual((await repo.getWorkspace(actor)).clients, []);
      assert.deepEqual((await repo.getWorkspace(actor)).tasks[0].clientIds, []);
      assert.equal(
        (await repo.getGeography(actor)).cities.length,
        divipola.cityCount,
      );
      await assertIntegrity(repo);
    }
  } finally {
    await repo.close();
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 50,
    });
  }
});
