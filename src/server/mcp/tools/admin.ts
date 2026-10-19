import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { runCommand } from "../../commands";
import { invitationService } from "../../auth";
import { createFirstProject, finishOnboarding } from "../../onboarding";
import { DomainError } from "../../repository";
import type { McpContext } from "../context";
import { defineTool } from "../define";
import { inline, list, textResult } from "../format";
import { color, confirm, id } from "../schemas";

const ADMIN = { readOnlyHint: false, destructiveHint: false } as const;
const sameEmail = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
// Invitation links are credentials for the invitee: they never leave the server through MCP.
const invitationView = (row: { id: string; email: string; createdAt: number; expiresAt: number; revokedAt: number | null; acceptedAt: number | null; projectIds?: string[]; deliveryStatus?: string }) => ({
  id: row.id,
  email: row.email,
  createdAt: new Date(row.createdAt).toISOString(),
  expiresAt: new Date(row.expiresAt).toISOString(),
  status: row.acceptedAt ? "aceptada" : row.revokedAt ? "revocada" : row.expiresAt < Date.now() ? "vencida" : "pendiente",
  projectIds: row.projectIds ?? [],
  deliveryStatus: row.deliveryStatus ?? null,
});

// Administrator tools: registered only for the installation administrator with taskode:admin,
// and every call re-checks the role (defineTool → requireAdmin). Backups and Trello import are
// intentionally not exposed.
export function registerAdminTools(server: McpServer, ctx: McpContext) {
  const invites = () => invitationService(ctx.repo);

  defineTool(server, ctx, {
    name: "admin_list_users",
    title: "Usuarios e invitaciones",
    description: "Lista los usuarios con sus accesos a proyectos y, opcionalmente, las invitaciones (sin enlaces).",
    access: "admin",
    annotations: { readOnlyHint: true },
    input: z.object({ includeInvitations: z.boolean().default(true) }),
    run: async ({ includeInvitations }) => {
      const users = await ctx.repo.users.list(ctx.actor);
      const invitations = includeInvitations ? (await invites().list(ctx.actor)).map(invitationView) : [];
      return textResult(
        [
          "## Usuarios",
          users
            .map(
              (user) =>
                `- ${inline(user.name)} <${user.email}> · ${user.role === "admin" ? "administrador" : "miembro"} · ${user.projectAccess.length} proyectos (id: \`${user.id}\`)`,
            )
            .join("\n"),
          includeInvitations ? "## Invitaciones" : "",
          includeInvitations
            ? invitations.map((row) => `- ${row.email} · ${row.status} · vence ${row.expiresAt} (id: \`${row.id}\`)`).join("\n") || "_Ninguna._"
            : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
        {
          users: users.map(({ id, name, email, role, projectAccess }) => ({ id, name, email, role, projectAccess })),
          invitations,
        },
      );
    },
  });

  defineTool(server, ctx, {
    name: "admin_get_user_projects",
    title: "Proyectos de un usuario",
    description:
      "Devuelve los proyectos de un usuario con sus responsabilidades (tareas, módulos y features que lidera) y la revisión necesaria para modificarlos.",
    access: "admin",
    annotations: { readOnlyHint: true },
    input: z.object({ userId: id }),
    run: async ({ userId }) => {
      const snapshot = await ctx.repo.users.projects(ctx.actor, userId);
      return textResult(
        list([
          `# ${inline(snapshot.user.name)} <${snapshot.user.email}> · revisión \`${snapshot.revision}\``,
          ...snapshot.projects.map(
            (project) =>
              `- ${project.icon} ${inline(project.name)} (id: \`${project.projectId}\`) · acceso ${project.access ?? "ninguno"}${project.leadsProject ? " · líder" : ""} · lidera ${project.tasks} tareas, ${project.modules} módulos, ${project.features} features`,
          ),
        ]),
        snapshot as unknown as Record<string, unknown>,
      );
    },
  });

  defineTool(server, ctx, {
    name: "admin_update_user_projects",
    title: "Cambiar accesos de un usuario",
    description:
      "Añade o retira proyectos a un usuario. Al retirar, indica reemplazos para sus responsabilidades (replacements) y confirma con su correo exacto. Requiere la revisión de admin_get_user_projects.",
    access: "admin",
    annotations: { ...ADMIN, destructiveHint: true },
    input: z.object({
      userId: id,
      revision: z.string().regex(/^[a-f0-9]{64}$/),
      addProjectIds: z.array(id).max(100).default([]),
      removeProjectIds: z.array(id).max(100).default([]),
      replacements: z.array(z.object({ projectId: id, userId: id })).max(100).default([]),
      confirm: confirm.optional().describe("Obligatorio al retirar proyectos: correo exacto del usuario."),
    }),
    target: (args) => ({ type: "user", id: args.userId }),
    run: async ({ userId, confirm: confirmation, ...input }) => {
      if (input.removeProjectIds.length) {
        const { user } = await ctx.repo.users.projects(ctx.actor, userId);
        if (!confirmation || !sameEmail(confirmation, user.email))
          throw new DomainError("Para retirar proyectos, escribe en confirm el correo exacto del usuario.");
      }
      const snapshot = await ctx.repo.users.update(ctx.actor, userId, input);
      ctx.effects.notifications();
      return textResult(`Accesos actualizados. Nueva revisión \`${snapshot.revision}\`.`, { revision: snapshot.revision });
    },
  });

  defineTool(server, ctx, {
    name: "admin_invite",
    title: "Invitar o reenviar invitación",
    description:
      "Invita a una persona por correo con proyectos iniciales (si ya tiene cuenta, se le asignan directamente) o reenvía una invitación existente. El correo lo envía Taskode; el enlace no se devuelve.",
    access: "admin",
    annotations: { ...ADMIN, openWorldHint: true },
    input: z.object({
      email: z.email().optional(),
      projectIds: z.array(id).max(100).default([]),
      resendInvitationId: id.optional(),
    }),
    target: (args) => ({ type: "invitation", id: args.resendInvitationId ?? null }),
    run: async ({ email, projectIds, resendInvitationId }) => {
      if (!email && !resendInvitationId) throw new DomainError("Indica un correo o la invitación a reenviar.");
      const result = resendInvitationId
        ? await invites().resend(resendInvitationId, ctx.actor)
        : await invites().create({ email, projectIds }, ctx.actor);
      ctx.effects.notifications();
      if (result.kind === "assigned")
        return textResult(`La persona ya tenía cuenta: se le asignaron ${result.addedProjectIds.length} proyectos.`, {
          kind: result.kind,
          userId: result.userId,
          addedProjectIds: result.addedProjectIds,
        });
      return textResult(`Invitación enviada a ${result.invitation.email} (id: \`${result.invitation.id}\`).`, {
        kind: result.kind,
        invitation: invitationView(result.invitation),
      });
    },
  });

  defineTool(server, ctx, {
    name: "admin_revoke_invitation",
    title: "Revocar invitación",
    description: "Revoca una invitación pendiente. Confirma con el correo exacto de la invitación.",
    access: "admin",
    annotations: { ...ADMIN, destructiveHint: true, idempotentHint: true },
    input: z.object({ invitationId: id, confirm }),
    target: (args) => ({ type: "invitation", id: args.invitationId }),
    run: async ({ invitationId, confirm: confirmation }) => {
      const invitation = (await invites().list(ctx.actor)).find((row) => row.id === invitationId);
      if (!invitation) throw new DomainError("La invitación no existe.", 404);
      if (!sameEmail(confirmation, invitation.email))
        throw new DomainError("La confirmación no coincide con el correo de la invitación. No se revocó nada.");
      await invites().revoke(invitationId, ctx.actor);
      return `Invitación de ${invitation.email} revocada.`;
    },
  });

  defineTool(server, ctx, {
    name: "admin_update_settings",
    title: "Configuración del espacio",
    description: "Cambia el tamaño máximo de los archivos adjuntos (entre 1 y 100 MB, en bytes).",
    access: "admin",
    annotations: { ...ADMIN, idempotentHint: true },
    input: z.object({ maxAttachmentBytes: z.number().int().min(1_048_576).max(104_857_600) }),
    run: async ({ maxAttachmentBytes }) => {
      await runCommand(ctx.repo, { type: "settings.update", maxAttachmentBytes }, ctx.actor, ctx.effects);
      return `Tamaño máximo de archivo: ${maxAttachmentBytes} bytes.`;
    },
  });

  defineTool(server, ctx, {
    name: "admin_onboarding",
    title: "Configuración inicial",
    description:
      "Completa el asistente inicial: crea el primer proyecto (opcionalmente con ejemplos de una aplicación web) o finaliza el asistente.",
    access: "admin",
    annotations: ADMIN,
    input: z.object({
      action: z.enum(["create_first_project", "finish"]),
      project: z
        .object({
          name: z.string().min(1).max(160),
          description: z.string().max(30000).default(""),
          icon: z.string().min(1).max(32).default("🚀"),
          color: color.default("#059669"),
        })
        .optional(),
      demo: z.boolean().default(false),
    }),
    run: async ({ action, project, demo }) => {
      if (action === "finish") {
        await finishOnboarding(ctx.repo, ctx.actor);
        return "Configuración inicial finalizada.";
      }
      if (!project) throw new DomainError("Indica los datos del proyecto.");
      const { projectId } = await createFirstProject(ctx.repo, ctx.actor, project, demo);
      return textResult(`Primer proyecto listo (id: \`${projectId}\`).`, { projectId: projectId ?? null });
    },
  });
}
