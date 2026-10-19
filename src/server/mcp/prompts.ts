import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

const ask = (text: string) => ({ messages: [{ role: "user" as const, content: { type: "text" as const, text } }] });

// Ready-made workflows a person can pick from their client's prompt menu.
export function registerPrompts(server: McpServer) {
  server.registerPrompt(
    "resumen_diario",
    {
      title: "Resumen del día",
      description: "Tus tareas pendientes, vencidas y próximas, con prioridades.",
      argsSchema: z.object({ projectId: z.string().optional().describe("Limita el resumen a un proyecto.") }),
    },
    ({ projectId }) =>
      ask(
        `Prepara mi resumen del día en Taskode${projectId ? ` para el proyecto ${projectId}` : ""}. ` +
          "Usa search_tasks con assignee=\"me\" y done=false (ordenado por vencimiento) y también overdue=true. " +
          "Agrupa en: vencidas, vencen hoy, próximos 7 días y sin fecha. Para cada tarea indica prioridad y estado, " +
          "y termina con las tres acciones que recomiendas hacer primero. Revisa también list_notifications sin leer. " +
          "No modifiques nada.",
      ),
  );
  server.registerPrompt(
    "planificar_sprint",
    {
      title: "Planificar sprint",
      description: "Propone un plan de trabajo para las próximas semanas de un proyecto.",
      argsSchema: z.object({
        projectId: z.string().describe("Id del proyecto."),
        semanas: z.string().optional().describe("Duración del sprint en semanas (por defecto 2)."),
      }),
    },
    ({ projectId, semanas }) =>
      ask(
        `Ayúdame a planificar un sprint de ${semanas || "2"} semanas para el proyecto ${projectId}. ` +
          "Lee la estructura con get_project_tree y las tareas pendientes con search_tasks (done=false). " +
          "Propón qué tareas entran, en qué orden, responsables y fechas de vencimiento, teniendo en cuenta prioridades, " +
          "dependencias evidentes y la carga de cada persona. Presenta el plan y pregúntame antes de aplicar cambios; " +
          "solo cuando lo confirme usa update_task, move_task o set_assignment.",
      ),
  );
  server.registerPrompt(
    "revisar_tarea",
    {
      title: "Revisar tarea",
      description: "Analiza una tarea: claridad, criterios de aceptación, checklist y riesgos.",
      argsSchema: z.object({ taskId: z.string().describe("Id de la tarea.") }),
    },
    ({ taskId }) =>
      ask(
        `Revisa la tarea ${taskId} de Taskode con get_task (incluye historial). Evalúa si la descripción es clara, ` +
          "si tiene criterios de aceptación verificables, si el checklist cubre el trabajo y qué riesgos o dudas ves. " +
          "Propón mejoras concretas (texto de descripción y ítems de checklist) y pregúntame antes de guardarlas.",
      ),
  );
}
