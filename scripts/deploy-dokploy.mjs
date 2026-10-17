import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

process.chdir(resolve(import.meta.dirname, ".."));
if ((process.argv[2] || "prepare") !== "prepare") {
  console.error("El despliegue antiguo de la web en Dokploy fue retirado. Usa Vercel para la web y consulta docs/despliegue-vercel-dokploy.md para PostgreSQL.");
  process.exitCode = 1;
} else {
  execFileSync("docker", ["compose", "-f", "compose.dokploy.yaml", "config", "--no-interpolate", "--quiet"], { stdio: "pipe" });
  mkdirSync(".dokploy", { recursive: true });
  writeFileSync(".dokploy/compose.yaml", readFileSync("compose.dokploy.yaml"));
  console.log("Preparado .dokploy/compose.yaml: solo PostgreSQL con TLS. No se ha conectado ni desplegado en Dokploy.");
}
