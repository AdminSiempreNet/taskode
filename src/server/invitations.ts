import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, isNull, gt } from "drizzle-orm";
import { Resend } from "resend";
import { z } from "zod";
import type { Actor } from "../lib/types";
import type { PostgresRepository } from "./postgres";
import * as s from "./schema";
import { DomainError } from "./repository";

const fields = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  projectIds: z.array(z.string().min(1)).max(100).default([]),
});
export type Mailer = (data: {
  to: string;
  url: string;
  inviter: string;
}) => Promise<void>;
export async function sendInvitationEmail(data: {
  to: string;
  url: string;
  inviter: string;
}) {
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL)
    throw new Error(
      "Configura RESEND_API_KEY y RESEND_FROM_EMAIL para enviar correos.",
    );
  const escape = (value: string) =>
    value.replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c]!,
    );
  const result = await new Resend(process.env.RESEND_API_KEY).emails.send({
    from: process.env.RESEND_FROM_EMAIL,
    to: data.to,
    subject: "Te han invitado a Brote",
    text: `${data.inviter} te invita a Brote. Acepta con Google o GitHub usando este correo. El enlace vence en 7 días: ${data.url}`,
    html: `<h1>Te han invitado a Brote</h1><p>${escape(data.inviter)} te invita a colaborar.</p><p>Accede con Google o GitHub usando el correo de esta invitación.</p><p><a href="${escape(data.url)}">Aceptar invitación</a></p><p>El enlace vence en 7 días.</p>`,
  });
  if (result.error) throw new Error(result.error.message);
}
export class InvitationService {
  constructor(
    private repo: PostgresRepository,
    private secret: string,
    private baseURL: string,
    private mailer: Mailer = sendInvitationEmail,
  ) {}
  private signature(id: string, expiresAt: number) {
    return createHmac("sha256", this.secret)
      .update(`brote-invitation:${id}:${expiresAt}`)
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
      expected = Buffer.from(this.signature(id, expiresAt)),
      actual = Buffer.from(signature);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
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
    for (const p of projects)
      await this.repo.store.db
        .insert(s.projectMembers)
        .values({ projectId: p.projectId, userId })
        .onConflictDoNothing();
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
  async create(input: unknown, actor: Actor) {
    const admin = await this.repo.requireAdmin(actor),
      parsed = fields.safeParse(input);
    if (!parsed.success)
      throw new DomainError(
        "Escribe un correo válido y selecciona los proyectos.",
      );
    const { email, projectIds } = parsed.data;
    const row = await this.repo.store.transaction(async () => {
      for (const id of projectIds)
        await this.repo.requireProject(actor, id, true);
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
      return row;
    });
    return this.deliver(row, admin.name);
  }
  private async deliver(
    row: typeof s.invitations.$inferSelect,
    inviter: string,
  ) {
    let error: string | null = null;
    try {
      await this.mailer({ to: row.email, url: this.url(row), inviter });
    } catch (e) {
      error = e instanceof Error ? e.message : "No se pudo enviar el correo.";
    }
    const deliveryStatus = error ? "failed" : "sent";
    await this.repo.store.transaction(async () => {
      await this.repo.store.db
        .update(s.invitations)
        .set({ deliveryStatus })
        .where(eq(s.invitations.id, row.id));
    });
    return {
      invitation: { ...row, deliveryStatus, url: this.url(row) },
      deliveryError: error,
    };
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
    const row = (
      await this.repo.store.db
        .select()
        .from(s.invitations)
        .where(eq(s.invitations.id, id))
    )[0];
    if (!row || row.acceptedAt)
      throw new DomainError("La invitación no se puede reenviar.");
    const projects = await this.repo.store.db
      .select()
      .from(s.invitationProjects)
      .where(eq(s.invitationProjects.invitationId, id));
    return this.create(
      { email: row.email, projectIds: projects.map((p) => p.projectId) },
      actor,
    );
  }
}
