import { createHash } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Actor } from "../lib/types";
import { userProjectsUpdateSchema, type ManagedUser, type UserProjectsSnapshot } from "../lib/users";
import type { PostgresRepository } from "./postgres";
import { DomainError } from "./repository";
import * as s from "./schema";

export class UsersService {
  constructor(private repo: PostgresRepository) {}

  async list(actor: Actor): Promise<ManagedUser[]> {
    await this.repo.requireAdmin(actor);
    return this.repo.store.snapshot(async () => {
      const users = await this.repo.store.db.select({ id: s.user.id, name: s.user.name, email: s.user.email, image: s.user.image, role: s.user.role }).from(s.user);
      const projects = await this.repo.store.db.select().from(s.projects).orderBy(s.projects.id);
      const members = await this.repo.store.db.select().from(s.projectTeamMembers).orderBy(s.projectTeamMembers.projectId, s.projectTeamMembers.userId);
      return users.sort((a, b) => a.name.localeCompare(b.name, "es") || a.id.localeCompare(b.id)).map(user => ({
        ...user,
        projectAccess: projects.flatMap(project => {
          const source = user.role === "admin" ? "admin" as const : project.leaderId === user.id ? "leader" as const : members.some(m => m.projectId === project.id && m.userId === user.id) ? "member" as const : null;
          return source ? [{ projectId: project.id, source }] : [];
        }),
      }));
    });
  }

  async projects(actor: Actor, userId: string): Promise<UserProjectsSnapshot> {
    await this.repo.requireAdmin(actor);
    return this.repo.store.snapshot(async () => {
      const users = await this.list(actor);
      const user = users.find(u => u.id === userId);
      if (!user) throw new DomainError("El usuario no existe.", 404);
      const projects = await this.repo.store.db.select().from(s.projects).orderBy(s.projects.id);
      const members = await this.repo.store.db.select().from(s.projectTeamMembers).orderBy(s.projectTeamMembers.projectId, s.projectTeamMembers.userId);
      const tasks = await this.repo.store.db.select({ id: s.tasks.id, projectId: s.tasks.projectId }).from(s.tasks).where(eq(s.tasks.leaderId, userId)).orderBy(s.tasks.id);
      const modules = await this.repo.store.db.select({ id: s.modules.id, projectId: s.modules.projectId }).from(s.modules).where(eq(s.modules.leaderId, userId)).orderBy(s.modules.id);
      const features = await this.repo.store.db.select({ id: s.features.id, projectId: s.features.projectId }).from(s.features).where(eq(s.features.leaderId, userId)).orderBy(s.features.id);
      return {
        user,
        revision: createHash("sha256").update(JSON.stringify({ user, projects, members, tasks, modules, features })).digest("hex"),
        projects: projects.map(p => ({
          projectId: p.id, name: p.name, icon: p.icon,
          access: user.projectAccess.find(a => a.projectId === p.id)?.source ?? null,
          leadsProject: p.leaderId === userId,
          tasks: tasks.filter(t => t.projectId === p.id).length,
          modules: modules.filter(t => t.projectId === p.id).length,
          features: features.filter(t => t.projectId === p.id).length,
          candidates: users.filter(u => u.id !== userId && u.projectAccess.some(a => a.projectId === p.id)).map(u => ({ id: u.id, name: u.name, email: u.email, image: u.image, projectId: p.id })),
        })),
      };
    });
  }

  async revokePending(email: string) {
    await this.repo.store.db.update(s.invitations).set({ revokedAt: Date.now() }).where(and(sql`lower(${s.invitations.email}) = ${email.toLowerCase()}`, isNull(s.invitations.acceptedAt), isNull(s.invitations.revokedAt)));
  }

  async assign(actor: Actor, userId: string, projectIds: string[]) {
    return this.repo.store.transaction(async () => {
      const snapshot = await this.projects(actor, userId);
      const result = await this.update(actor, userId, {
        revision: snapshot.revision,
        addProjectIds: projectIds,
        removeProjectIds: [],
        replacements: [],
      });
      return { userId, addedProjectIds: result.user.projectAccess.filter(a => !snapshot.user.projectAccess.some(old => old.projectId === a.projectId)).map(a => a.projectId) };
    });
  }

  async update(actor: Actor, userId: string, input: unknown): Promise<UserProjectsSnapshot> {
    await this.repo.requireAdmin(actor);
    const parsed = userProjectsUpdateSchema.safeParse(input);
    if (!parsed.success) throw new DomainError("Revisa los proyectos y sus reemplazos.");
    return this.repo.store.transaction(async () => {
      const current = await this.projects(actor, userId);
      if (current.revision !== parsed.data.revision) throw new DomainError("Los accesos o responsabilidades cambiaron. Recarga y revisa el resumen antes de guardar.", 409);
      const add = [...new Set(parsed.data.addProjectIds)], remove = [...new Set(parsed.data.removeProjectIds)];
      if (add.some(id => remove.includes(id))) throw new DomainError("No puedes añadir y retirar el mismo proyecto.");
      if ([...add, ...remove].some(id => !current.projects.some(p => p.projectId === id))) throw new DomainError("El proyecto no existe.", 404);
      if (current.user.role === "admin") {
        if (remove.length) throw new DomainError("El administrador tiene acceso a todos los proyectos.", 409);
        return current;
      }
      if (new Set(parsed.data.replacements.map(r => r.projectId)).size !== parsed.data.replacements.length || parsed.data.replacements.some(r => !remove.includes(r.projectId))) throw new DomainError("Revisa los reemplazos seleccionados.");
      for (const projectId of remove) {
        const p = current.projects.find(p => p.projectId === projectId)!;
        if (!p.access) continue;
        const replacement = parsed.data.replacements.find(r => r.projectId === projectId);
        if ((p.leadsProject || p.tasks || p.modules || p.features) && !replacement) throw new DomainError(`Selecciona quién asumirá las responsabilidades en ${p.name}.`, 409);
        if (replacement && !p.candidates.some(c => c.id === replacement.userId)) throw new DomainError("El reemplazo debe ser otra persona con acceso al proyecto.", 409);
      }
      for (const projectId of add)
        if (!current.user.projectAccess.some(a => a.projectId === projectId)) await this.repo.execute({ type: "project.team.add", projectId, userId }, actor);
      for (const projectId of remove) {
        const p = current.projects.find(p => p.projectId === projectId)!;
        if (!p.access) continue;
        const replacement = parsed.data.replacements.find(r => r.projectId === projectId)?.userId;
        if (replacement) {
          for (const kind of ["module", "feature", "task"] as const) {
            const table = kind === "module" ? s.modules : kind === "feature" ? s.features : s.tasks;
            const owned = await this.repo.store.db.select({ id: table.id }).from(table).where(and(eq(table.projectId, projectId), eq(table.leaderId, userId)));
            for (const row of owned) {
              let teamMemberIds: string[];
              if (kind === "module") teamMemberIds = (await this.repo.store.db.select().from(s.moduleTeamMembers).where(eq(s.moduleTeamMembers.moduleId, row.id))).map(m => m.userId);
              else if (kind === "feature") teamMemberIds = (await this.repo.store.db.select().from(s.featureTeamMembers).where(eq(s.featureTeamMembers.featureId, row.id))).map(m => m.userId);
              else teamMemberIds = (await this.repo.store.db.select().from(s.taskTeamMembers).where(eq(s.taskTeamMembers.taskId, row.id))).map(m => m.userId);
              await this.repo.execute({ type: `${kind}.assignment.update`, id: row.id, leaderId: replacement, teamMemberIds: teamMemberIds.filter(id => id !== userId && id !== replacement) }, actor);
            }
          }
          if (p.leadsProject) await this.repo.execute({ type: "project.leader.update", id: projectId, userId: replacement }, actor);
        }
        await this.repo.execute({ type: "project.team.remove", projectId, userId }, actor);
      }
      if (add.length || remove.length) await this.revokePending(current.user.email);
      return this.projects(actor, userId);
    });
  }
}
