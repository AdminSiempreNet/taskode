import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

process.chdir(resolve(import.meta.dirname, ".."));
if ((process.argv[2] || "prepare") !== "prepare") {
  console.error("El despliegue antiguo de la web en Dokploy fue retirado. Usa Vercel para la web y consulta docs/despliegue-vercel-dokploy.md para PostgreSQL.");
  process.exitCode = 1;
} else {
  execFileSync("docker", ["compose", "-f", "compose.dokploy.yaml", "config", "--no-interpolate", "--quiet"], { stdio: "pipe" });
  const config = JSON.parse(execFileSync("docker", ["compose", "-f", "compose.dokploy.yaml", "config", "--no-interpolate", "--format", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  const worker = { ...config.services.notifications };
  delete worker.networks;
  const scheduler = { ...config.configs["notification-scheduler"] };
  delete scheduler.name;
  mkdirSync(".dokploy", { recursive: true });
  writeFileSync(".dokploy/compose.yaml", readFileSync("compose.dokploy.yaml"));
  writeFileSync(".dokploy/notifications.compose.yaml", JSON.stringify({ services: { notifications: worker }, configs: { "notification-scheduler": scheduler } }, null, 2));
  console.log("Preparados .dokploy/compose.yaml y .dokploy/notifications.compose.yaml. El segundo permite añadir el programador sin modificar PostgreSQL. No se ha conectado ni desplegado en Dokploy.");
}
