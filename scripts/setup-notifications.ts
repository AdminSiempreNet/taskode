import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { randomBytes } from "node:crypto";
import webpush from "web-push";
import { pushConfig } from "../src/server/notification-delivery";

// Secrets stay in ignored environment files; stdout contains only field names.
const production = process.argv.includes("--production");
const filename = production ? ".env.production.local" : ".env.local";
const path = resolve(process.cwd(), filename);
let source = existsSync(path) ? readFileSync(path, "utf8") : "";
const env = parseEnv(source),
  changed: string[] = [];
function set(key: string, value: string) {
  const pattern = new RegExp(`^${key}=.*$`, "m");
  source = pattern.test(source)
    ? source.replace(pattern, () => `${key}=${value}`)
    : `${source.replace(/\s*$/, "")}\n${key}=${value}\n`;
  env[key] = value;
  changed.push(key);
}
try {
  if (!env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && !env.VAPID_PRIVATE_KEY) {
    const keys = webpush.generateVAPIDKeys();
    set("NEXT_PUBLIC_VAPID_PUBLIC_KEY", keys.publicKey);
    set("VAPID_PRIVATE_KEY", keys.privateKey);
  }
  if (!env.VAPID_SUBJECT)
    set(
      "VAPID_SUBJECT",
      production ? "https://taskode.siempre.net.co" : "mailto:admin@example.com",
    );
  pushConfig(env);
  if (!env.NOTIFICATION_WORKER_SECRET)
    set("NOTIFICATION_WORKER_SECRET", randomBytes(32).toString("base64url"));
  if ((env.NOTIFICATION_WORKER_SECRET?.length ?? 0) < 32)
    throw Error(
      "El secreto del programador debe tener al menos 32 caracteres.",
    );
  if (changed.length) writeFileSync(path, source, { mode: 0o600 });
  console.log(
    changed.length
      ? `Configurado ${filename}: ${changed.join(", ")}.`
      : `${filename} ya contiene una configuración válida.`,
  );
} catch {
  console.error(
    "No se modificó el archivo: revisa las claves VAPID, el contacto y el secreto del programador existentes.",
  );
  process.exitCode = 1;
}
