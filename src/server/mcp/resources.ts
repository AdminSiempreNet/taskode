import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/server";
import { DocumentsService } from "../documents";
import type { McpContext } from "./context";
import { entityUrl, featureName, loadTask, loadWorkspace, lookups, taskLine, taskMarkdown } from "./domain";
import { inline, untrusted } from "./format";

const variable = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";
const markdown = (uri: URL, text: string) => ({
  contents: [{ uri: uri.href, mimeType: "text/markdown", text }],
});

// Read-only views of the same data the tools return, for clients that attach resources.
export function registerResources(server: McpServer, ctx: McpContext) {
  server.registerResource(
    "project",
    new ResourceTemplate("taskode://projects/{projectId}", {
      list: async () => {
        const workspace = await loadWorkspace(ctx);
        return {
          resources: workspace.projects.map((project) => ({
            uri: `taskode://projects/${project.id}`,
            name: project.name,
            mimeType: "text/markdown",
          })),
        };
      },
    }),
    { title: "Proyecto", description: "Resumen de un proyecto con sus features y tareas abiertas.", mimeType: "text/markdown" },
    async (uri, variables) => {
      const projectId = variable(variables.projectId);
      await ctx.repo.requireProject(ctx.actor, projectId);
      const workspace = await loadWorkspace(ctx, [projectId]);
      const names = lookups(workspace);
      const project = workspace.projects[0];
      const open = workspace.tasks.filter((task) => !task.archived && !names.statuses.get(task.statusId)?.isDone);
      return markdown(
        uri,
        [
          `# ${project.icon} ${inline(project.name)}`,
          entityUrl(ctx, project.id, "project", project.id),
          project.description ? untrusted("descripcion", project.description, { proyecto: project.id }) : "",
          "## Features",
          workspace.features.map((feature) => `- ${featureName(names, feature.id)} (id: \`${feature.id}\`)`).join("\n") || "_Ninguna._",
          `## Tareas abiertas (${open.length})`,
          open.slice(0, 200).map((task) => taskLine(ctx, names, task)).join("\n") || "_Ninguna._",
        ]
          .filter(Boolean)
          .join("\n\n"),
      );
    },
  );
  server.registerResource(
    "task",
    new ResourceTemplate("taskode://tasks/{taskId}", { list: undefined }),
    { title: "Tarea", description: "Una tarea completa en Markdown.", mimeType: "text/markdown" },
    async (uri, variables) => {
      const { task, workspace } = await loadTask(ctx, variable(variables.taskId));
      return markdown(uri, taskMarkdown(ctx, workspace, task, { history: true }));
    },
  );
  server.registerResource(
    "document",
    new ResourceTemplate("taskode://documents/{documentId}", { list: undefined }),
    { title: "Documento", description: "Un documento de Taskode en Markdown.", mimeType: "text/markdown" },
    async (uri, variables) => {
      const doc = await new DocumentsService(ctx.repo).get(ctx.actor, variable(variables.documentId));
      return markdown(uri, `# ${inline(doc.title)}\n\n${untrusted("documento", doc.content, { id: doc.id })}`);
    },
  );
}
