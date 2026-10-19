// Spanish descriptions shown on the consent screen and in «Aplicaciones conectadas».
export const SCOPE_LABELS: Record<string, { title: string; description: string }> = {
  "taskode:read": {
    title: "Consultar tu trabajo",
    description:
      "Ver tus proyectos, tareas, comentarios, documentos, diagramas, archivos, tickets y avisos.",
  },
  "taskode:write": {
    title: "Modificar en tu nombre",
    description:
      "Crear, editar, mover, comentar y eliminar contenido con tus mismos permisos.",
  },
  "taskode:admin": {
    title: "Administrar Taskode",
    description:
      "Gestionar usuarios, invitaciones y la configuración del espacio. Caduca a los 15 minutos.",
  },
  offline_access: {
    title: "Mantener la conexión",
    description: "Seguir conectada hasta 30 días sin volver a iniciar sesión.",
  },
  openid: { title: "Identificarte", description: "Saber qué cuenta autorizó el acceso." },
  profile: { title: "Ver tu perfil", description: "Tu nombre y foto." },
  email: { title: "Ver tu correo", description: "La dirección de tu cuenta." },
};
export const IDENTITY_SCOPES = new Set(["openid", "profile", "email"]);
export function scopeLabel(scope: string) {
  return SCOPE_LABELS[scope] ?? { title: scope, description: "Permiso adicional solicitado." };
}
