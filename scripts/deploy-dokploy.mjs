import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseEnv } from "node:util";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

// Credentials stay in this process and the CLI's environment, never in argv.
const root = resolve(import.meta.dirname, "..");
process.chdir(root);
const local = parseEnv(readFileSync(".env.local", "utf8"));
const mode = process.argv[2] || "prepare";
const server = "https://server.eduinpro.net";
const domain = "tareas.eduinpro.net";
const metadataPath = ".dokploy/deployment.json";
const secretValues = Object.entries(local)
  .filter(([key, value]) => /KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL/.test(key) && value)
  .map(([, value]) => value);
const scrub = (message) => secretValues.reduce(
  (text, value) => text.replaceAll(value, "[REDACTED]"), String(message),
);
const run = (command, args, options = {}) => execFileSync(command, args, {
  cwd: root, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 10 * 1024 * 1024, ...options,
});

function prepare() {
  // An explicit allowlist excludes .env files, databases, tests and local artifacts.
  const rootFiles = new Set([
    "package.json", "package-lock.json", "next.config.ts", "next-env.d.ts",
    "tsconfig.json", "postcss.config.mjs", "Dockerfile",
  ]);
  const files = run("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"])
    .toString().split("\0").filter((file) =>
      (rootFiles.has(file) || /^(src|drizzle\/postgresql)\//.test(file) || file === "scripts/migrate.ts") && existsSync(file),
    ).sort();
  for (const file of files) {
    if (lstatSync(file).isSymbolicLink() || /(^|\/)\.env/.test(file)) {
      throw new Error(`Archivo no permitido: ${file}`);
    }
  }
  const archive = gzipSync(run("tar", ["-cf", "-", "--", ...files]), { level: 9 });
  const digest = createHash("sha256").update(archive).digest("hex");
  const encoded = archive.toString("base64");
  // Small file mounts avoid the Linux shell argument limit in Dokploy's raw
  // Compose writer. Source files are build inputs, separate from runtime env.
  const sourceMounts = encoded.match(/.{1,48000}/g).map((content, index) => ({
    filePath: `build/${digest}/source-${String(index).padStart(3, "0")}.b64`, content,
  }));
  const sourceStage = `# syntax=docker/dockerfile:1\nFROM node:24-bookworm-slim AS source\nWORKDIR /source\nCOPY build/${digest}/ /tmp/source/\nRUN cat /tmp/source/*.b64 | base64 -d > /tmp/source.tar.gz && echo '${digest}  /tmp/source.tar.gz' | sha256sum -c - && tar -xzf /tmp/source.tar.gz -C /source\n\n`;
  let dockerfile = readFileSync("Dockerfile", "utf8").replaceAll("\r\n", "\n");
  if (!dockerfile.includes("COPY package.json package-lock.json ./") || !dockerfile.includes("COPY . .")) {
    throw new Error("El Dockerfile cambió; revisa cómo se incorpora el código empaquetado.");
  }
  dockerfile = sourceStage + dockerfile
    .replace("COPY package.json package-lock.json ./", "COPY --from=source /source/package.json /source/package-lock.json ./")
    .replace("COPY . .", "COPY --from=source /source/ ./");
  const inline = dockerfile.replaceAll("$", "$$").trimEnd().split("\n").map((line) => `        ${line}`).join("\n");
  const compose = readFileSync("compose.dokploy.yaml", "utf8")
    .replaceAll("      context: .", "      context: ../files")
    .replaceAll("      dockerfile: Dockerfile", `      dockerfile_inline: |\n${inline}`);
  if (secretValues.some((secret) => compose.includes(secret))) throw new Error("Se detectó un secreto en el Compose.");
  mkdirSync(".dokploy", { recursive: true });
  writeFileSync(".dokploy/compose.yaml", compose);
  writeFileSync(".dokploy/source-mounts.json", JSON.stringify(sourceMounts));
  writeFileSync(".dokploy/source-manifest.json", JSON.stringify({ sha256: digest, files }, null, 2));
  run("docker", ["compose", "-f", ".dokploy/compose.yaml", "config", "--no-interpolate", "--quiet"]);
  console.log(JSON.stringify({ prepared: true, files: files.length, archiveBytes: archive.length, composeBytes: Buffer.byteLength(compose), sha256: digest }));
  return { composeFile: compose, sourceMounts };
}

async function api() {
  if (!local.DOKPLOY_API_KEY) throw new Error("Falta DOKPLOY_API_KEY en .env.local.");
  process.env.DOKPLOY_URL = server;
  process.env.DOKPLOY_API_KEY = local.DOKPLOY_API_KEY;
  const npmRoot = process.platform === "win32"
    ? join(dirname(run("where.exe", ["dokploy.cmd"]).toString().trim().split(/\r?\n/)[0]), "node_modules")
    : run("npm", ["root", "--global"]).toString().trim();
  const { createClient } = await import(pathToFileURL(join(npmRoot, "@dokploy", "cli", "dist", "client.js")).href);
  const client = createClient();
  // Use the documented REST endpoints; this CLI version's tRPC GET encoding
  // is incompatible with parameterized queries on the installed server.
  return {
    apiGet: (endpoint, params = {}) => client.get(`/${endpoint}`, { params }).then((response) => response.data),
    apiPost: (endpoint, data) => client.post(`/${endpoint}`, data).then((response) => response.data),
  };
}

async function main() {
  if (mode === "prepare") return prepare();
  const { apiGet, apiPost } = await api();
  if (mode === "deploy") {
    const { composeFile, sourceMounts } = prepare();
    if (!local.BETTER_AUTH_SECRET || local.BETTER_AUTH_SECRET.length < 32) {
      throw new Error("BETTER_AUTH_SECRET debe tener al menos 32 caracteres.");
    }
    const projects = await apiGet("project.all", {});
    let project = projects.find((item) => item.name === "SiempreNet");
    if (!project) project = await apiPost("project.create", { name: "SiempreNet", description: "Aplicaciones de SiempreNet" });
    project = await apiGet("project.one", { projectId: project.projectId });
    const environment = project.environments.find((item) => item.name === "production");
    if (!environment) throw new Error("No se encontró el entorno production.");
    let compose = (environment.compose || []).find((item) => item.name === "tareas");
    if (!compose) compose = await apiPost("compose.create", {
      name: "tareas", environmentId: environment.environmentId, composeType: "docker-compose",
      appName: "siemprenet-tareas", description: "Brote: proyectos y tareas", composeFile,
    });
    const current = await apiGet("compose.one", { composeId: compose.composeId });
    for (const mount of sourceMounts) {
      if (!(current.mounts || []).some((item) => item.filePath === mount.filePath)) {
        await apiPost("mounts.create", {
          type: "file", serviceType: "compose", serviceId: compose.composeId,
          mountPath: `/build-only/${mount.filePath}`, ...mount,
        });
      }
    }
    const applicationKeys = ["POSTGRES_DB", "POSTGRES_PASSWORD", "BROTE_DB_PASSWORD", "BETTER_AUTH_SECRET", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET", "RESEND_API_KEY", "RESEND_FROM_EMAIL"];
    const env = applicationKeys.filter((key) => local[key]).map((key) => {
      if (/[\r\n]/.test(local[key])) throw new Error(`Valor multilínea no admitido: ${key}`);
      return `${key}='${local[key].replaceAll("'", "\\'")}'`;
    }).join("\n") + "\n";
    await apiPost("compose.update", {
      composeId: compose.composeId, sourceType: "raw", composeType: "docker-compose",
      composeFile, env, createEnvFile: true, randomize: false,
    });
    const domains = await apiGet("domain.byComposeId", { composeId: compose.composeId });
    if (!domains.some((item) => item.host === domain)) await apiPost("domain.create", {
      host: domain, path: "/", port: 5010, https: true, certificateType: "letsencrypt",
      composeId: compose.composeId, serviceName: "brote", domainType: "compose",
    });
    const metadata = { server, domain, projectId: project.projectId, environmentId: environment.environmentId, composeId: compose.composeId, appName: compose.appName };
    writeFileSync(metadataPath, JSON.stringify(metadata, null, 2) + "\n");
    await apiPost("compose.deploy", { composeId: compose.composeId });
    console.log(JSON.stringify({ deployed: true, ...metadata }));
    return;
  }
  const { composeId } = JSON.parse(readFileSync(metadataPath, "utf8"));
  if (mode === "status") {
    const compose = await apiGet("compose.one", { composeId });
    const deployments = await apiGet("deployment.allByCompose", { composeId });
    console.log(JSON.stringify({ composeId, composeStatus: compose.composeStatus, deployments: deployments.slice(0, 3).map(({ deploymentId, status, title, description, createdAt, logPath }) => ({ deploymentId, status, title, description, createdAt, logPath })) }, null, 2));
  } else if (mode === "logs") {
    const [deployment] = await apiGet("deployment.allByCompose", { composeId });
    console.log(scrub(await apiGet("deployment.readLogs", { deploymentId: deployment.deploymentId, tail: 100 })));
  } else throw new Error("Modo desconocido: prepare, deploy, status o logs.");
}

main().catch((error) => {
  // Axios errors contain request headers; never serialize the error object.
  const message = error.response?.data?.error?.json?.message || error.response?.data?.message || error.message;
  console.error(scrub(`Dokploy: ${message}`));
  process.exitCode = 1;
});
