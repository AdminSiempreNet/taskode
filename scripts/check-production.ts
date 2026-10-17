import { loadEnvConfig } from "@next/env";
import { databasePoolConfig } from "../src/server/database-config";
import { s3BackupConfig } from "../src/server/s3-backup-storage";

loadEnvConfig(process.cwd());
try {
  if (process.env.VERCEL === "1") {
    if (process.env.VERCEL_ENV !== "production")
      throw new Error("Este proyecto despliega solo Production. Configura main como Production Branch; no reutilices la base de producción en Preview.");
    if (process.env.VERCEL_GIT_COMMIT_REF && process.env.VERCEL_GIT_COMMIT_REF !== "main")
      throw new Error("La rama de producción de este proyecto debe ser main. Los push a dev no despliegan.");
  }
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
  s3BackupConfig();
  console.log("Configuración de producción válida. No se ha conectado ni desplegado ningún servicio.");
} catch (error) {
  // Never log environment values or connection URLs.
  console.error(error instanceof Error ? error.message : "Configuración de producción inválida.");
  process.exitCode = 1;
}
