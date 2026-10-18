import { test } from "node:test";
import assert from "node:assert/strict";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createEmptyRepository, testDatabaseUrl } from "./postgres-fixture";
import { createRepository, actor, addUser, authConfig } from "./helpers";
import { PostgresRepository } from "../src/server/postgres";
import { databaseUrl } from "../src/server/database";
import {
  migrationsFolder,
  expectedMigration,
} from "../src/server/migration-info";
import { repository } from "../src/server";
import { GET as health } from "../src/app/api/health/route";
import { InvitationService } from "../src/server/invitations";
import { projectMembers } from "../src/server/schema";
import migrationJournal from "../drizzle/postgresql/meta/_journal.json";

test("DATABASE_URL es obligatoria y TEST_DATABASE_URL no puede usar la base de desarrollo", () => {
  const previous = process.env.DATABASE_URL;
  try {
    delete process.env.DATABASE_URL;
    assert.throws(databaseUrl, /Configura DATABASE_URL/);
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    assert.throws(testDatabaseUrl, /base dedicada/);
    assert.throws(
      () => new PostgresRepository(":memory:"),
      /conexión PostgreSQL/,
    );
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
});

test("la instalación vacía no contiene usuarios y repetir migraciones conserva personalizaciones", async () => {
  const repo = await createEmptyRepository();
  try {
    assert.equal(
      (await repo.store.pool.query('select count(*)::int as n from "user"'))
        .rows[0].n,
      0,
    );
    assert.equal((await repo.store.state()).adminId, null);
    await addUser(repo, actor.id, "admin");
    const { createdId } = await repo.execute(
      {
        type: "project.create",
        name: "Conservar",
        description: "",
        icon: "🌱",
        color: "#059669",
      },
      actor,
    );
    const before = await repo.getWorkspace(actor);
    await repo.execute(
      {
        type: "taskType.delete",
        projectId: createdId!,
        id: before.taskTypes[0].id,
      },
      actor,
    );
    const customized = await repo.getWorkspace(actor);
    await migrate(drizzle(repo.store.pool), {
      migrationsFolder: migrationsFolder(),
      migrationsSchema: repo.store.schemaName,
    });
    assert.deepEqual(await repo.getWorkspace(actor), customized);
    assert.equal(
      (
        await repo.store.pool.query(
          "select count(*)::int as n from __drizzle_migrations",
        )
      ).rows[0].n,
      migrationJournal.entries.length,
    );
  } finally {
    await repo.close();
  }
});

test("health comprueba conexión y versión; el arranque no repara silenciosamente un esquema incompatible", async () => {
  const repo = await createEmptyRepository();
  Object.assign(globalThis, { taskodeRepository: repo });
  let peer: PostgresRepository | undefined;
  try {
    assert.equal((await health()).status, 200);
    await repo.store.pool.query(
      "update __drizzle_migrations set hash='incompatible'",
    );
    assert.equal((await health()).status, 503);
    peer = new PostgresRepository(repo.store.connectionString, {
      schema: repo.store.schemaName,
    });
    await assert.rejects(peer.store.ready, /db:migrate/);
    assert.equal(
      (await repo.store.pool.query("select hash from __drizzle_migrations"))
        .rows[0].hash,
      "incompatible",
    );
    await repo.store.pool.query("update __drizzle_migrations set hash=$1", [
      expectedMigration().hash,
    ]);
    await peer.store.health();
    assert.equal((await peer.store.state()).adminId, null);
  } finally {
    Reflect.deleteProperty(globalThis, "taskodeRepository");
    await peer?.close();
    await repo.close();
  }
});

test("Fast Refresh retira el pool anterior y el cierre libera las conexiones", async () => {
  const fixture = await createEmptyRepository();
  const previousUrl = process.env.DATABASE_URL;
  const previousSchema = process.env.DATABASE_SCHEMA;
  const globals = globalThis as typeof globalThis & {
    taskodeRepository?: PostgresRepository;
  };
  const previous = globals.taskodeRepository;
  const stale = new PostgresRepository(fixture.store.connectionString, {
    schema: fixture.store.schemaName,
  });
  let current: PostgresRepository | undefined;
  try {
    await stale.store.ready;
    Object.defineProperty(stale, "cacheVersion", { value: -1 });
    globals.taskodeRepository = stale;
    process.env.DATABASE_URL = fixture.store.connectionString;
    process.env.DATABASE_SCHEMA = fixture.store.schemaName;
    current = repository();
    await current.store.ready;
    await stale.close();
    assert.notEqual(current, stale);
    assert.equal(stale.store.pool.ending, true);
    assert.equal(stale.store.pool.totalCount, 0);
    await current.close();
    assert.equal(current.store.pool.ending, true);
    assert.equal(current.store.pool.totalCount, 0);
  } finally {
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
    if (previousSchema === undefined) delete process.env.DATABASE_SCHEMA;
    else process.env.DATABASE_SCHEMA = previousSchema;
    globals.taskodeRepository = previous;
    await stale.close();
    await current?.close();
    await fixture.close();
  }
});

test("dos instancias serializan numeración y límite de cinco features fijadas", async () => {
  const repo = await createRepository();
  const peer = new PostgresRepository(repo.store.connectionString, {
    schema: repo.store.schemaName,
  });
  try {
    const projectId = (
      await repo.execute(
        {
          type: "project.create",
          name: "Concurrente",
          description: "",
          icon: "🌱",
          color: "#059669",
        },
        actor,
      )
    ).createdId!;
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        (i % 2 ? repo : peer).execute(
          {
            type: "feature.create",
            projectId,
            name: `Feature ${i}`,
            description: "",
          },
          actor,
        ),
      ),
    );
    const features = (await repo.getWorkspace(actor)).features;
    assert.deepEqual(
      features.map((row) => row.number).sort((a, b) => a - b),
      [1, 2, 3, 4, 5, 6, 7, 8, 9],
    );
    const results = await Promise.allSettled(
      features.map((row, i) =>
        (i % 2 ? repo : peer).execute(
          { type: "feature.pin", id: row.id, pinned: true },
          actor,
        ),
      ),
    );
    assert.equal(results.filter((row) => row.status === "fulfilled").length, 5);
    assert.equal(
      (await peer.getWorkspace(actor)).features.filter((row) => row.pinned)
        .length,
      5,
    );
  } finally {
    await peer.close();
    await repo.close();
  }
});

test("dos instancias consumen una invitación una sola vez y otorgan participación una sola vez", async () => {
  const repo = await createRepository();
  const peer = new PostgresRepository(repo.store.connectionString, {
    schema: repo.store.schemaName,
  });
  try {
    await addUser(repo, "member");
    const projectId = (
      await repo.execute(
        {
          type: "project.create",
          name: "Invitación",
          description: "",
          icon: "🌱",
          color: "#059669",
        },
        actor,
      )
    ).createdId!;
    const service = new InvitationService(
      repo,
      authConfig.BETTER_AUTH_SECRET,
      authConfig.BETTER_AUTH_URL,
      async () => {},
    );
    const other = new InvitationService(
      peer,
      authConfig.BETTER_AUTH_SECRET,
      authConfig.BETTER_AUTH_URL,
      async () => {},
    );
    const created = await service.create(
      { email: "member@example.com", projectIds: [projectId] },
      actor,
    );
    const token = new URL(created.invitation.url).pathname.split("/").at(-1)!;
    const results = await Promise.allSettled([
      service.consume(token, "member", "member@example.com"),
      other.consume(token, "member", "member@example.com"),
    ]);
    assert.equal(
      results.filter((result) => result.status === "fulfilled").length,
      1,
    );
    assert.equal((await repo.store.db.select().from(projectMembers)).length, 1);
  } finally {
    await peer.close();
    await repo.close();
  }
});

test("las lecturas transaccionales ven un snapshot consistente mientras otra instancia escribe", async () => {
  const repo = await createRepository();
  const peer = new PostgresRepository(repo.store.connectionString, {
    schema: repo.store.schemaName,
  });
  try {
    await repo.store.snapshot(async () => {
      assert.equal((await repo.getWorkspace(actor)).projects.length, 0);
      await peer.execute(
        {
          type: "project.create",
          name: "Posterior",
          description: "",
          icon: "🌱",
          color: "#059669",
        },
        actor,
      );
      assert.equal((await repo.getWorkspace(actor)).projects.length, 0);
    });
    assert.equal((await repo.getWorkspace(actor)).projects.length, 1);
  } finally {
    await peer.close();
    await repo.close();
  }
});
