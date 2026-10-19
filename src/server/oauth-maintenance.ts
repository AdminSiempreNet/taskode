import { and, inArray, isNotNull, isNull, lt, notExists, or, sql } from "drizzle-orm";
import type { PostgresRepository } from "./postgres";
import * as schema from "./schema";

const DAY = 86_400_000;
const BATCH = 200;
// Periodic cleanup of OAuth data that no longer grants anything. Runs from the notification
// worker; every step is bounded so a large backlog is drained over several runs.
export async function pruneOAuthData(repo: PostgresRepository, now = new Date()) {
  await repo.store.ready;
  return repo.store.transaction(async () => {
    const db = repo.store.db;
    const before = (days: number) => new Date(now.getTime() - days * DAY);
    const expiredTokens = (table: typeof schema.oauthAccessToken | typeof schema.oauthRefreshToken) =>
      or(lt(table.expiresAt, before(7)), and(isNotNull(table.revoked), lt(table.revoked, before(7))));
    const accessTokens = await db
      .select({ id: schema.oauthAccessToken.id })
      .from(schema.oauthAccessToken)
      .where(expiredTokens(schema.oauthAccessToken))
      .limit(BATCH);
    if (accessTokens.length)
      await db.delete(schema.oauthAccessToken).where(inArray(schema.oauthAccessToken.id, accessTokens.map((row) => row.id)));
    const refreshTokens = await db
      .select({ id: schema.oauthRefreshToken.id })
      .from(schema.oauthRefreshToken)
      .where(expiredTokens(schema.oauthRefreshToken))
      .limit(BATCH);
    if (refreshTokens.length)
      await db.delete(schema.oauthRefreshToken).where(inArray(schema.oauthRefreshToken.id, refreshTokens.map((row) => row.id)));
    // Dynamically registered clients that nobody authorized: every new connection registers one.
    const live = (clientId: typeof schema.oauthClient.clientId) => [
      notExists(db.select({ id: schema.oauthConsent.id }).from(schema.oauthConsent).where(sql`${schema.oauthConsent.clientId} = ${clientId}`)),
      notExists(
        db
          .select({ id: schema.oauthRefreshToken.id })
          .from(schema.oauthRefreshToken)
          .where(sql`${schema.oauthRefreshToken.clientId} = ${clientId} and ${schema.oauthRefreshToken.revoked} is null`),
      ),
    ];
    const clients = await db
      .select({ clientId: schema.oauthClient.clientId })
      .from(schema.oauthClient)
      .where(
        and(
          isNull(schema.oauthClient.userId),
          isNull(schema.oauthClient.referenceId),
          or(
            and(isNull(schema.oauthClient.clientDiscoveryId), lt(schema.oauthClient.createdAt, before(1))),
            and(isNotNull(schema.oauthClient.clientDiscoveryId), lt(schema.oauthClient.updatedAt, before(30))),
          ),
          ...live(schema.oauthClient.clientId),
        ),
      )
      .limit(BATCH);
    if (clients.length)
      await db.delete(schema.oauthClient).where(inArray(schema.oauthClient.clientId, clients.map((row) => row.clientId)));
    await db.delete(schema.oauthClientAssertion).where(lt(schema.oauthClientAssertion.expiresAt, now));
    const activity = await db
      .select({ id: schema.mcpActivity.id })
      .from(schema.mcpActivity)
      .where(lt(schema.mcpActivity.createdAt, before(90)))
      .limit(BATCH * 5);
    if (activity.length)
      await db.delete(schema.mcpActivity).where(inArray(schema.mcpActivity.id, activity.map((row) => row.id)));
    return {
      accessTokens: accessTokens.length,
      refreshTokens: refreshTokens.length,
      clients: clients.length,
      activity: activity.length,
    };
  });
}
