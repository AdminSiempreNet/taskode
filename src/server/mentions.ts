import { eq } from "drizzle-orm";
import type { Actor, EntityRef } from "../lib/types";
import {
  contentMentions,
  type MentionContext,
  type MentionOptions,
} from "../lib/mentions";
import type { PostgresRepository } from "./postgres";
import * as s from "./schema";
import { DomainError } from "./repository";

export class MentionsService {
  constructor(readonly repo: PostgresRepository) {}
  async options(
    actor: Actor,
    context: MentionContext,
  ): Promise<MentionOptions> {
    await this.repo.currentUser(actor);
    let users: MentionOptions["users"];
    if ("scope" in context) {
      const { scope } = await this.repo.requireEntity(
        actor,
        context.scope.kind,
        context.scope.id,
        context.scope.projectId,
      );
      const allowed = new Set(
        await this.repo.commentRecipients(scope.id, scope.kind),
      );
      users = (await this.repo.projectPeople(actor, scope.projectId)).filter(
        (u) => allowed.has(u.id),
      );
    } else if (context.draft.kind === "project") {
      users = (await this.repo.store.db.select().from(s.user))
        .filter((u) => u.role === "admin" || u.id === actor.id)
        .map(({ id, name, email, image }) => ({ id, name, email, image }));
    } else {
      const draft = context.draft;
      if (!draft.projectId)
        throw new DomainError("Falta el proyecto de la mención.");
      const project = await this.repo.requireProject(actor, draft.projectId);
      users = await this.repo.projectPeople(actor, draft.projectId);
      if (draft.kind === "task") {
        const allowed = new Set([
          String(project.leaderId),
          draft.leaderId || actor.id,
          ...(draft.teamMemberIds ?? []),
        ]);
        if (draft.featureId) {
          const { entity: feature } = await this.repo.requireEntity(
            actor,
            "feature",
            draft.featureId,
            draft.projectId,
          );
          allowed.add(String(feature.leaderId));
          if (feature.moduleId) {
            const { entity: module } = await this.repo.requireEntity(
              actor,
              "module",
              String(feature.moduleId),
              draft.projectId,
            );
            allowed.add(String(module.leaderId));
          }
        }
        const admins = new Set(
          (
            await this.repo.store.db
              .select({ id: s.user.id })
              .from(s.user)
              .where(eq(s.user.role, "admin"))
          ).map((u) => u.id),
        );
        users = users.filter((u) => allowed.has(u.id) || admins.has(u.id));
      }
    }
    const clients = await this.repo.store.db
      .select({
        id: s.clients.id,
        name: s.clients.name,
        cityName: s.cities.name,
        departmentName: s.departments.name,
      })
      .from(s.clients)
      .innerJoin(s.cities, eq(s.clients.cityId, s.cities.id))
      .innerJoin(s.departments, eq(s.cities.departmentId, s.departments.id));
    return {
      users: users.sort((a, b) => a.name.localeCompare(b.name, "es")),
      clients: clients.sort((a, b) => a.name.localeCompare(b.name, "es")),
      tickets: (await this.repo.store.db.select().from(s.tickets))
        .map((ticket) => ({ id: ticket.id, number: ticket.number, description: ticket.description, url: ticket.url,
          clientName: clients.find((client) => client.id === ticket.clientId)?.name ?? null }))
        .sort((a, b) => a.number.localeCompare(b.number, "es", { numeric: true }) || a.id.localeCompare(b.id)),
    };
  }
  async changed(
    actor: Actor,
    scope: EntityRef,
    previous: string,
    next: string,
    source: { commentId?: string; documentId?: string } = {},
  ) {
    const old = new Set(
      contentMentions(previous).map((r) => `${r.type}:${r.id}`),
    );
    const added = contentMentions(next).filter(
      (r) => !old.has(`${r.type}:${r.id}`),
    );
    if (!added.length) return;
    const allowed = new Set(
      await this.repo.commentRecipients(scope.id, scope.kind),
    );
    const clients = new Set(
      (
        await this.repo.store.db.select({ id: s.clients.id }).from(s.clients)
      ).map((c) => c.id),
    );
    const tickets = new Set((await this.repo.store.db.select({ id: s.tickets.id }).from(s.tickets)).map((ticket) => ticket.id));
    for (const ref of added) {
      if (!(ref.type === "user" ? allowed : ref.type === "client" ? clients : tickets).has(ref.id))
        throw new DomainError(
          "Una mención ya no está disponible o el usuario no tiene acceso. Revisa las menciones; tu borrador se conserva.",
        );
      if (ref.type === "user" && ref.id !== actor.id)
        await this.repo.notifications.mentioned(scope, actor, ref.id, source);
    }
  }
}
