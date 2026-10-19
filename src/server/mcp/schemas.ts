import { z } from "zod";

// Tool inputs stay permissive and descriptive; commandSchema and the services validate strictly.
export const id = z.string().min(1).max(200);
export const entityKind = z.enum(["project", "module", "feature", "task"]);
export const entity = z
  .object({
    kind: entityKind.describe("Tipo de elemento: project, module, feature o task."),
    id: id.describe("Id del elemento."),
  })
  .describe("Elemento de Taskode (proyecto, módulo, feature o tarea).");
export const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Usa el formato AAAA-MM-DD.")
  .describe("Fecha AAAA-MM-DD en la zona horaria del proyecto.");
export const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Usa el formato HH:MM.");
export const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Usa un color #RRGGBB.");
export const ids = z.array(id).max(1000);
export const confirm = z
  .string()
  .min(1)
  .max(300)
  .describe("Confirmación: escribe exactamente el nombre, título o número del elemento a eliminar.");
export const textMode = z
  .enum(["replace", "append"])
  .default("replace")
  .describe("replace sustituye el texto; append lo añade al final.");
