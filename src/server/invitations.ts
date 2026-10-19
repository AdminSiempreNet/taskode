import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { and, eq, isNull, gt, sql } from "drizzle-orm";
import { z } from "zod";
import type { Actor } from "../lib/types";
import type { PostgresRepository } from "./postgres";
import * as s from "./schema";
import { DomainError } from "./repository";

const fields = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  projectIds: z.array(z.string().min(1)).max(100).default([]),
});
export type InvitationResult =
  | { kind: "invitation"; invitation: typeof s.invitations.$inferSelect & { url: string }; deliveryError: null }
  | { kind: "assigned"; userId: string; addedProjectIds: string[] };
export class InvitationService {
  constructor(
    private repo: PostgresRepository,
    private secret: string,
    private baseURL: string,
  ) {}
  private signature(id: string, expiresAt: number, brand = "taskode") {
    return createHmac("sha256", this.secret)
      .update(`${brand}-invitation:${id}:${expiresAt}`)
      .digest("base64url");
  }
  token(row: typeof s.invitations.$inferSelect) {
    return `${row.id}.${row.expiresAt}.${this.signature(row.id, row.expiresAt)}`;
  }
  url(row: typeof s.invitations.$inferSelect) {
    return new URL(`/invite/${this.token(row)}`, this.baseURL).toString();
  }
  async verify(token: string, email?: string) {
    await this.repo.store.ready;
    const [id, expiration, signature, ...extra] = token.split(".");
    if (!id || !/^\d+$/.test(expiration ?? "") || !signature || extra.length)
      throw new DomainError("La invitación no es válida.", 400);
    const expiresAt = Number(expiration),
      actual = Buffer.from(signature);
    // Previously emailed links remain valid until their original expiration.
    const valid = ["taskode", "brote"].some((brand) => {
      const expected = Buffer.from(this.signature(id, expiresAt, brand));
      return expected.length === actual.length && timingSafeEqual(expected, actual);
    });
    if (!valid)
      throw new DomainError("La invitación no es válida.", 400);
    const row = (
      await this.repo.store.db
        .select()
        .from(s.invitations)
        .where(eq(s.invitations.id, id))
    )[0];
    if (
      !row ||
      row.expiresAt !== expiresAt ||
      row.revokedAt ||
      row.acceptedAt ||
      expiresAt <= Date.now()
    )
      throw new DomainError(
        "La invitación venció, fue revocada o ya se utilizó.",
        400,
      );
    if (email && row.email !== email.trim().toLowerCase())
      throw new DomainError(
        "Accede con la cuenta cuyo correo coincide con la invitación.",
        403,
      );
    return row;
  }
  async consume(token: string, userId: string, email: string) {
    return this.repo.store.transaction(() =>
      this.consumeInTransaction(token, userId, email),
    );
  }
  private async consumeInTransaction(
    token: string,
    userId: string,
    email: string,
  ) {
    const row = await this.verify(token, email);
    const changed = await this.repo.store.db
      .update(s.invitations)
      .set({ acceptedAt: Date.now(), acceptedBy: userId })
      .where(
        and(
          eq(s.invitations.id, row.id),
          isNull(s.invitations.acceptedAt),
          isNull(s.invitations.revokedAt),
          gt(s.invitations.expiresAt, Date.now()),
        ),
      )
      .returning();
    if (!changed.length)
      throw new DomainError("La invitación ya no está disponible.", 409);
    const projects = await this.repo.store.db
      .select()
      .from(s.invitationProjects)
      .where(eq(s.invitationProjects.invitationId, row.id));
    for (const p of projects) {
      const access = await this.repo.notifications.projectAccess(p.projectId);
      if (!access?.userIds.includes(userId)) await this.repo.execute({ type: "project.team.add", projectId: p.projectId, userId }, { id: row.createdBy });
    }
    const accepted = await this.repo.currentUser({ id: userId });
    await this.repo.notifications.accountEvent({
      recipientId: row.createdBy, actorId: userId, type: "invitation_accepted",
      title: accepted.email, dedupKey: `invitation-accepted:${row.id}`,
    });
  }
  async list(actor: Actor) {
    await this.repo.requireAdmin(actor);
    const rows = await this.repo.store.db.select().from(s.invitations);
    const assignments = await this.repo.store.db
      .select()
      .from(s.invitationProjects);
    return rows
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((row) => ({
        ...row,
        projectIds: assignments
          .filter((a) => a.invitationId === row.id)
          .map((a) => a.projectId),
        url: this.url(row),
      }));
  }
  async create(input: unknown, actor: Actor): Promise<InvitationResult> {
    const admin = await this.repo.requireAdmin(actor),
      parsed = fields.safeParse(input);
    if (!parsed.success)
      throw new DomainError(
        "Escribe un correo válido y selecciona los proyectos.",
      );
    const { email, projectIds } = parsed.data;
    return this.repo.store.transaction(async () => {
      for (const id of projectIds)
        await this.repo.requireProject(actor, id, true);
      const [existing] = await this.repo.store.db.select().from(s.user).where(sql`lower(${s.user.email}) = ${email}`);
      if (existing) return { kind: "assigned" as const, ...await this.repo.users.assign(actor, existing.id, projectIds) };
      const now = Date.now();
      await this.repo.store.db
        .update(s.invitations)
        .set({ revokedAt: now })
        .where(
          and(
            eq(s.invitations.email, email),
            isNull(s.invitations.acceptedAt),
            isNull(s.invitations.revokedAt),
          ),
        );
      const [row] = await this.repo.store.db
        .insert(s.invitations)
        .values({
          id: randomBytes(24).toString("base64url"),
          email,
          createdBy: admin.id,
          createdAt: now,
          expiresAt: now + 7 * 86400000,
        })
        .returning();
      for (const projectId of new Set(projectIds))
        await this.repo.store.db
          .insert(s.invitationProjects)
          .values({ invitationId: row.id, projectId });
      await this.repo.store.db.insert(s.notificationDeliveries).values({
        id: randomUUID(), invitationId: row.id, transport: "email", expiresAt: new Date(row.expiresAt),
      });
      return { kind: "invitation" as const, invitation: { ...row, url: this.url(row) }, deliveryError: null };
    });
  }
  async revoke(id: string, actor: Actor) {
    await this.repo.requireAdmin(actor);
    await this.repo.store.transaction(async () => {
      await this.repo.store.db
        .update(s.invitations)
        .set({ revokedAt: Date.now() })
        .where(eq(s.invitations.id, id));
    });
  }
  async resend(id: string, actor: Actor) {
    await this.repo.requireAdmin(actor);
    return this.repo.store.transaction(async () => {
      const row = (
        await this.repo.store.db
          .select()
          .from(s.invitations)
          .where(eq(s.invitations.id, id))
      )[0];
      if (!row || row.acceptedAt)
        throw new DomainError("La invitación no se puede reenviar.");
      const [existing] = await this.repo.store.db.select({ id: s.user.id }).from(s.user).where(sql`lower(${s.user.email}) = ${row.email.toLowerCase()}`);
      if (existing) throw new DomainError("Esta persona ya está registrada. Gestiona sus proyectos desde Usuarios.", 409);
      const projects = await this.repo.store.db
        .select()
        .from(s.invitationProjects)
        .where(eq(s.invitationProjects.invitationId, id));
      return this.create(
        { email: row.email, projectIds: projects.map((p) => p.projectId) },
        actor,
      );
    });
  }
}
