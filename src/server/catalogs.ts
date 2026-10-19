import { count, eq, sql, and, or, isNull, type SQL } from "drizzle-orm";
import type { Actor, Client, EntityKind } from "../lib/types";
import type { CatalogTicket, TicketLink, TicketPageQuery } from "../lib/catalogs";
import { entityPath } from "../lib/routes";
import { normalizeClientText } from "../lib/clients";
import { pageMetadata, type PageQuery, type Paginated } from "../lib/pagination";
import type { PostgresRepository } from "./postgres";
import * as s from "./schema";
import { DomainError } from "./repository";

const clientFields = {
  id: s.clients.id, name: s.clients.name, cityId: s.clients.cityId,
  cityName: s.cities.name, departmentId: s.departments.id, departmentName: s.departments.name,
  createdAt: s.clients.createdAt, updatedAt: s.clients.updatedAt,
};

function searchCondition(value: SQL, query: string) {
  if (!query) return undefined;
  const pattern = `%${normalizeClientText(query).replace(/[\\%_]/g, "\\$&")}%`;
  // Match the existing accent-insensitive search without requiring an extension.
  const normalized = sql`regexp_replace(regexp_replace(normalize(lower(${value}), NFD), ${"[\u0300-\u036f]"}, '', 'g'), '[[:space:]]+', ' ', 'g')`;
  return sql`${normalized} like ${pattern} escape ${"\\"}`;
}

export class CatalogsService {
  constructor(readonly repo: PostgresRepository) {}

  async clients(actor: Actor, input: PageQuery, selectedId?: string): Promise<Paginated<Client>> {
    return this.repo.store.snapshot(async () => {
      await this.repo.currentUser(actor);
      const condition = and(selectedId ? eq(s.clients.id, selectedId) : undefined,
        searchCondition(sql`concat_ws(' ', ${s.clients.name}, ${s.cities.name}, ${s.departments.name})`, input.q));
      const [result] = await this.repo.store.db.select({ total: count() }).from(s.clients)
        .innerJoin(s.cities, eq(s.clients.cityId, s.cities.id))
        .innerJoin(s.departments, eq(s.cities.departmentId, s.departments.id)).where(condition);
      const meta = pageMetadata(result.total, input.page, input.pageSize);
      const items = await this.repo.store.db.select(clientFields).from(s.clients)
        .innerJoin(s.cities, eq(s.clients.cityId, s.cities.id))
        .innerJoin(s.departments, eq(s.cities.departmentId, s.departments.id)).where(condition)
        .orderBy(s.clients.normalizedName, s.clients.id).limit(meta.pageSize).offset((meta.page - 1) * meta.pageSize);
      return { items, ...meta };
    });
  }

  async tickets(actor: Actor, input: TicketPageQuery): Promise<Paginated<CatalogTicket>> {
    return this.repo.store.snapshot(async () => {
      await this.repo.currentUser(actor);
      const condition = and(
        input.clientId ? eq(s.tickets.clientId, input.clientId) : undefined,
        input.withoutClient ? isNull(s.tickets.clientId) : undefined,
        searchCondition(sql`concat_ws(' ', ${s.tickets.number}, ${s.tickets.description}, ${s.tickets.url}, ${s.clients.name})`, input.q),
      );
      const [result] = await this.repo.store.db.select({ total: count() }).from(s.tickets)
        .leftJoin(s.clients, eq(s.tickets.clientId, s.clients.id)).where(condition);
      const meta = pageMetadata(result.total, input.page, input.pageSize);
      const rows = await this.repo.store.db.select({ ticket: s.tickets, client: clientFields }).from(s.tickets)
        .leftJoin(s.clients, eq(s.tickets.clientId, s.clients.id))
        .leftJoin(s.cities, eq(s.clients.cityId, s.cities.id))
        .leftJoin(s.departments, eq(s.cities.departmentId, s.departments.id)).where(condition)
        .orderBy(sql`lower(${s.tickets.number})`, s.tickets.id).limit(meta.pageSize).offset((meta.page - 1) * meta.pageSize);
      return { items: rows.map(({ ticket, client }) => ({ ...ticket, client: client?.id ? client as Client : null })), ...meta };
    });
  }

  async ticketLinks(actor: Actor, ticketId: string, kind: EntityKind, input: PageQuery): Promise<Paginated<TicketLink>> {
    return this.repo.store.snapshot(async () => {
      const user = await this.repo.currentUser(actor), db = this.repo.store.db;
      if (!(await db.select({ id: s.tickets.id }).from(s.tickets).where(eq(s.tickets.id, ticketId))).length)
        throw new DomainError("El ticket no existe.", 404);
      const projectAccess = user.role === "admin" ? undefined : or(
        eq(s.projects.leaderId, actor.id),
        sql`exists (select 1 from ${s.projectTeamMembers} pm where pm."projectId" = ${s.projects.id} and pm."userId" = ${actor.id})`,
      );
      const context = {
        projectId: sql<string>`${s.projects.id}`.as("project_id"),
        projectName: sql<string>`${s.projects.name}`.as("project_name"),
      };
      const linked = kind === "project"
        ? db.select({ ...context, id: s.projects.id, name: s.projects.name }).from(s.projects)
          .innerJoin(s.projectTickets, eq(s.projectTickets.projectId, s.projects.id))
          .where(and(eq(s.projectTickets.ticketId, ticketId), projectAccess)).as("linked")
        : kind === "module"
          ? db.select({ ...context, id: s.modules.id, name: s.modules.name }).from(s.modules)
            .innerJoin(s.moduleTickets, eq(s.moduleTickets.moduleId, s.modules.id))
            .innerJoin(s.projects, eq(s.modules.projectId, s.projects.id))
            .where(and(eq(s.moduleTickets.ticketId, ticketId), projectAccess)).as("linked")
          : kind === "feature"
            ? db.select({ ...context, id: s.features.id, name: s.features.name }).from(s.features)
              .innerJoin(s.featureTickets, eq(s.featureTickets.featureId, s.features.id))
              .innerJoin(s.projects, eq(s.features.projectId, s.projects.id))
              .where(and(eq(s.featureTickets.ticketId, ticketId), projectAccess)).as("linked")
            : db.select({ ...context, id: s.tasks.id, name: s.tasks.title }).from(s.tasks)
              .innerJoin(s.taskTickets, eq(s.taskTickets.taskId, s.tasks.id))
              .innerJoin(s.projects, eq(s.tasks.projectId, s.projects.id))
              .where(and(eq(s.taskTickets.ticketId, ticketId), projectAccess, user.role === "admin" ? undefined : this.repo.taskVisibility(actor))).as("linked");
      const condition = searchCondition(sql`concat_ws(' ', ${linked.name}, ${linked.projectName})`, input.q);
      const [result] = await db.select({ total: count() }).from(linked).where(condition);
      const meta = pageMetadata(result.total, input.page, input.pageSize);
      const rows = await db.select().from(linked).where(condition)
        .orderBy(linked.projectName, linked.name, linked.id).limit(meta.pageSize).offset((meta.page - 1) * meta.pageSize);
      return { ...meta, items: rows.map(({ projectId, ...row }) => ({ ...row, kind, href: entityPath(projectId, kind, row.id, "board", "tickets") })) };
    });
  }
}
