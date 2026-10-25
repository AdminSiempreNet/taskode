import { loadEnvConfig } from "@next/env";
import { databasePoolConfig } from "../src/server/database-config";
import { s3BackupConfig } from "../src/server/s3-backup-storage";
import { ablyConfig } from "../src/server/realtime-config";
import { pushConfig } from "../src/server/notification-delivery";

loadEnvConfig(process.cwd());
try {
  if (process.env.BETTER_AUTH_URL !== "https://taskode.siempre.net.co")
    throw new Error("Configura BETTER_AUTH_URL=https://taskode.siempre.net.co.");
  if ((process.env.BETTER_AUTH_SECRET || "").length < 32)
    throw new Error("BETTER_AUTH_SECRET debe contener al menos 32 caracteres.");
  if (!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) &&
      !(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET))
    throw new Error("Configura al menos un proveedor OAuth completo para poder acceder.");
  if (process.env.DATABASE_SSL !== "verify-full")
    throw new Error("La conexión de producción requiere DATABASE_SSL=verify-full.");
  if (!process.env.DATABASE_URL) throw new Error("Configura DATABASE_URL.");
  const url = new URL(process.env.DATABASE_URL);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || ["localhost", "127.0.0.1", "postgres"].includes(url.hostname))
    throw new Error("DATABASE_URL debe apuntar al endpoint externo de PostgreSQL en Dokploy.");
  databasePoolConfig(process.env.DATABASE_URL);
  if (process.env.BACKUP_STORAGE !== "s3") throw new Error("Configura BACKUP_STORAGE=s3.");
  if (process.env.ATTACHMENT_STORAGE !== "s3") throw new Error("Configura ATTACHMENT_STORAGE=s3 para conservar los archivos fuera del contenedor.");
  s3BackupConfig();
  if (!ablyConfig()) throw new Error("Configura ABLY_API_KEY para los comentarios en tiempo real.");
  if (!pushConfig()) throw new Error("Configura las claves VAPID para las notificaciones push.");
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) throw new Error("Configura RESEND_API_KEY y RESEND_FROM_EMAIL para las invitaciones y avisos de acceso.");
  if ((process.env.NOTIFICATION_WORKER_SECRET || "").length < 32) throw new Error("Configura NOTIFICATION_WORKER_SECRET con al menos 32 caracteres.");
  if (process.env.ABLY_CHANNEL_NAMESPACE !== "taskode-production")
    throw new Error("Configura ABLY_CHANNEL_NAMESPACE=taskode-production.");
  if (!["", "true", "false"].includes(process.env.MCP_ENABLED ?? ""))
    throw new Error("MCP_ENABLED solo admite true o false.");
  for (const origin of (process.env.MCP_ALLOWED_ORIGINS || "").split(",").map((value) => value.trim()).filter(Boolean)) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error("MCP_ALLOWED_ORIGINS debe contener orígenes https separados por comas.");
    }
    if (parsed.protocol !== "https:" || parsed.origin !== origin.replace(/\/$/, ""))
      throw new Error("MCP_ALLOWED_ORIGINS debe contener orígenes https separados por comas.");
  }
  console.log("Configuración de producción válida. No se ha conectado ni desplegado ningún servicio.");
} catch (error) {
  // Never log environment values or connection URLs.
  console.error(error instanceof Error ? error.message : "Configuración de producción inválida.");
  process.exitCode = 1;
}
