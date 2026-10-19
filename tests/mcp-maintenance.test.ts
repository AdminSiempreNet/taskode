import { test } from "node:test";
import assert from "node:assert/strict";
import { pruneOAuthData } from "../src/server/oauth-maintenance";
import * as schema from "../src/server/schema";
import { actor, createRepository } from "./helpers";

test("limpieza OAuth: borra clientes dinámicos sin uso, tokens vencidos y auditoría antigua; conserva lo vigente", async () => {
  const repo = await createRepository();
  try {
    const now = new Date();
    const days = (n: number) => new Date(now.getTime() + n * 86400000);
    const client = (clientId: string, createdAt: Date, extra = {}) => ({
      id: clientId, clientId, redirectUris: ["http://127.0.0.1/cb"], createdAt, updatedAt: createdAt, ...extra,
    });
    await repo.store.db.insert(schema.oauthClient).values([
      client("stale-dcr", days(-2)),
      client("fresh-dcr", now),
      client("used-dcr", days(-5)),
      client("owned", days(-90), { userId: actor.id }),
    ]);
    await repo.store.db.insert(schema.oauthConsent).values({
      id: "consent", clientId: "used-dcr", userId: actor.id, scopes: ["taskode:read"], createdAt: now, updatedAt: now,
    });
    const token = (id: string, expiresAt: Date) => ({
      id, token: id, clientId: "used-dcr", userId: actor.id, scopes: ["taskode:read"], expiresAt, createdAt: days(-40),
    });
    await repo.store.db.insert(schema.oauthRefreshToken).values([token("old-refresh", days(-10)), token("live-refresh", days(10))]);
    await repo.store.db.insert(schema.mcpActivity).values([
      { id: "old", userId: actor.id, clientId: "used-dcr", tool: "get_me", outcome: "ok", createdAt: days(-100) },
      { id: "new", userId: actor.id, clientId: "used-dcr", tool: "get_me", outcome: "ok", createdAt: now },
    ]);
    const result = await pruneOAuthData(repo, now);
    assert.deepEqual(result, { accessTokens: 0, refreshTokens: 1, clients: 1, activity: 1 });
    const clients = (await repo.store.db.select().from(schema.oauthClient)).map((row) => row.clientId).sort();
    assert.deepEqual(clients, ["fresh-dcr", "owned", "used-dcr"]);
    assert.deepEqual((await repo.store.db.select().from(schema.oauthRefreshToken)).map((row) => row.id), ["live-refresh"]);
    assert.deepEqual((await repo.store.db.select().from(schema.mcpActivity)).map((row) => row.id), ["new"]);
  } finally {
    await repo.close();
  }
});
