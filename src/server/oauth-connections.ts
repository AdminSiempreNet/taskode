import { randomUUID } from "node:crypto";
import { and, eq, isNull, max } from "drizzle-orm";
import { z } from "zod";
import type { Actor } from "../lib/types";
import { assertOrigin, httpError, requireActor } from "./access";
import { repository } from "./index";
import type { PostgresRepository } from "./postgres";
import { DomainError } from "./repository";
import * as schema from "./schema";

export interface ConnectedApp {
  clientId: string;
  name: string;
  verifiedHost: string | null;
  dynamic: boolean;
  scopes: string[];
  connectedAt: string;
  lastUsedAt: string | null;
}
// Applications a user authorized through OAuth (MCP clients). Revoking removes the consent,
// which the MCP endpoint checks on every request, and invalidates refresh tokens.
export class OAuthConnections {
  constructor(private readonly repo: PostgresRepository) {}
  async list(actor: Actor): Promise<ConnectedApp[]> {
    await this.repo.store.ready;
    const db = this.repo.store.db;
    const rows = await db
      .select({
        clientId: schema.oauthConsent.clientId,
        scopes: schema.oauthConsent.scopes,
        createdAt: schema.oauthConsent.createdAt,
        name: schema.oauthClient.name,
        discovery: schema.oauthClient.clientDiscoveryId,
        owner: schema.oauthClient.userId,
      })
      .from(schema.oauthConsent)
      .innerJoin(schema.oauthClient, eq(schema.oauthClient.clientId, schema.oauthConsent.clientId))
      .where(eq(schema.oauthConsent.userId, actor.id));
    const usage = await db
      .select({ clientId: schema.mcpActivity.clientId, last: max(schema.mcpActivity.createdAt) })
      .from(schema.mcpActivity)
      .where(eq(schema.mcpActivity.userId, actor.id))
      .groupBy(schema.mcpActivity.clientId);
    const lastUsed = new Map(usage.map((row) => [row.clientId, row.last]));
    const apps = new Map<string, ConnectedApp>();
    for (const row of rows) {
      const current = apps.get(row.clientId);
      if (current) {
        current.scopes = [...new Set([...current.scopes, ...row.scopes])];
        continue;
      }
      let verifiedHost: string | null = null;
      if (row.discovery)
        try {
          verifiedHost = new URL(row.clientId).host;
        } catch {}
      apps.set(row.clientId, {
        clientId: row.clientId,
        name: row.name || verifiedHost || "Aplicación sin nombre",
        verifiedHost,
        dynamic: !row.discovery && !row.owner,
        scopes: row.scopes,
        connectedAt: row.createdAt.toISOString(),
        lastUsedAt: lastUsed.get(row.clientId)?.toISOString() ?? null,
      });
    }
    return [...apps.values()].sort((a, b) => b.connectedAt.localeCompare(a.connectedAt));
  }
  async revoke(actor: Actor, clientId: string) {
    await this.repo.store.ready;
    await this.repo.store.transaction(async () => {
      const db = this.repo.store.db;
      const owned = and(
        eq(schema.oauthConsent.userId, actor.id),
        eq(schema.oauthConsent.clientId, clientId),
      );
      const removed = await db.delete(schema.oauthConsent).where(owned).returning({ id: schema.oauthConsent.id });
      if (!removed.length) throw new DomainError("La aplicación no está conectada a tu cuenta.", 404);
      await db
        .update(schema.oauthRefreshToken)
        .set({ revoked: new Date() })
        .where(
          and(
            eq(schema.oauthRefreshToken.userId, actor.id),
            eq(schema.oauthRefreshToken.clientId, clientId),
            isNull(schema.oauthRefreshToken.revoked),
          ),
        );
      await db
        .delete(schema.oauthAccessToken)
        .where(
          and(
            eq(schema.oauthAccessToken.userId, actor.id),
            eq(schema.oauthAccessToken.clientId, clientId),
          ),
        );
      await db.insert(schema.mcpActivity).values({
        id: randomUUID(),
        userId: actor.id,
        clientId,
        tool: "connection.revoke",
        outcome: "ok",
      });
    });
  }
}

const revokeSchema = z.object({ clientId: z.string().min(1).max(2048) });
export async function connectionsGet(request: Request) {
  try {
    const actor = await requireActor(request);
    return Response.json(
      { connections: await new OAuthConnections(repository()).list(actor) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return httpError(error);
  }
}
export async function connectionsDelete(request: Request) {
  try {
    assertOrigin(request);
    const actor = await requireActor(request);
    const parsed = revokeSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new DomainError("Aplicación inválida.");
    await new OAuthConnections(repository()).revoke(actor, parsed.data.clientId);
    return new Response(null, { status: 204 });
  } catch (error) {
    return httpError(error);
  }
}
