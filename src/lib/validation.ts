import { z } from "zod";
import { validTimeZone } from "./project-time";
import { ticketInputSchema } from "./tickets";
const id = z.string().min(1).max(200);
export const entityKindSchema = z.enum([
  "project",
  "module",
  "feature",
  "task",
]);
export const entityRefSchema = z.object({
  kind: entityKindSchema,
  id,
  projectId: id,
});
const name = z.string().trim().min(1, "Escribe un nombre.").max(160);
const description = z.string().max(30000).default("");
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(v + "T12:00:00Z");
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, "Fecha inválida.")
  .nullable();
const projectFields = {
  name,
  description,
  // Las secuencias con tonos de piel o banderas pueden superar 12 unidades UTF-16.
  icon: z.string().min(1).max(32),
  color,
};
const moduleFields = { name, description };
const featureFields = { name, description, moduleId: id.nullish() };
const statusFields = { name: name.max(60), color, isDone: z.boolean() };
const taskTitle = z.string().trim().min(1, "Escribe un título.").max(300);
const taskFields = {
  applicationIds: z.array(id).max(1000).optional(),
  clientIds: z.array(id).max(1000).optional(),
  title: taskTitle,
  description,
  featureId: id,
  statusId: id,
  priority: id,
  typeId: id.nullish(),
  impactId: id.nullish(),
  dueDate: date,
  startDate: date.optional(),
  startTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora de inicio inválida.")
    .nullish(),
  dueTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora inválida.")
    .nullish(),
  labels: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
};
export const trelloSchema = z.object({
  name,
  id: id.optional(),
  lists: z
    .array(
      z.object({
        id,
        name: name.max(60),
        closed: z.boolean().default(false),
        pos: z.number().optional(),
      }),
    )
    .max(200),
  cards: z
    .array(
      z.object({
        id,
        idList: id,
        name: taskTitle,
        desc: description,
        closed: z.boolean().default(false),
        due: z
          .string()
          .refine(
            (v) => !Number.isNaN(Date.parse(v)),
            "Fecha de Trello inválida.",
          )
          .nullable()
          .optional(),
        pos: z.number().optional(),
        labels: z
          .array(
            z.object({
              name: z.string().max(60).default(""),
              color: z.string().nullable().optional(),
            }),
          )
          .max(20)
          .default([]),
      }),
    )
    .max(10000),
});
export type TrelloBoard = z.infer<typeof trelloSchema>;
const assignmentFields = {
  id,
  leaderId: id,
  teamMemberIds: z.array(id).max(1000),
};
const currentCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("entity.applications.update"), scope: entityRefSchema.extend({ kind: z.enum(["module", "feature", "task"]) }), applicationIds: z.array(id).max(1000) }),
  z.object({ type: z.literal("entity.clients.update"), scope: entityRefSchema, clientIds: z.array(id).max(1000) }),
  z.object({ type: z.literal("entity.tickets.update"), scope: entityRefSchema, ticketIds: z.array(id).max(1000) }),
  z.object({ type: z.literal("ticket.create"), ...ticketInputSchema.shape, scope: entityRefSchema.optional() }),
  z.object({ type: z.literal("ticket.update"), id, ...ticketInputSchema.shape }),
  z.object({ type: z.literal("ticket.delete"), id }),
  z.object({ type: z.literal("project.timezone.update"), id, timeZone: z.string().refine(validTimeZone, "Zona horaria inválida.") }),
  z.object({ type: z.literal("client.create"), name, cityId: id }),
  z.object({ type: z.literal("client.update"), id, name, cityId: id }),
  z.object({ type: z.literal("client.delete"), id }),
  z.object({
    type: z.literal("project.assignment.update"),
    ...assignmentFields,
  }),
  z.object({
    type: z.literal("module.assignment.update"),
    ...assignmentFields,
  }),
  z.object({
    type: z.literal("feature.assignment.update"),
    ...assignmentFields,
  }),
  z.object({ type: z.literal("project.leader.update"), id, userId: id }),
  z.object({
    type: z.literal("project.team.add"),
    projectId: id,
    userId: id,
  }),
  z.object({
    type: z.literal("project.team.remove"),
    projectId: id,
    userId: id,
  }),
  z.object({ type: z.literal("project.create"), ...projectFields }),
  z.object({ type: z.literal("project.update"), id, ...projectFields }),
  z.object({ type: z.literal("project.rename"), id, name }),
  z.object({ type: z.literal("project.delete"), id }),
  z.object({
    type: z.literal("module.create"),
    projectId: id,
    ...moduleFields,
  }),
  z.object({ type: z.literal("module.update"), id, ...moduleFields }),
  z.object({ type: z.literal("module.rename"), id, name }),
  z.object({ type: z.literal("module.delete"), id }),
  z.object({
    type: z.literal("module.reorder"),
    projectId: id,
    ids: z.array(id).min(1).max(10000),
  }),
  z.object({
    type: z.literal("feature.create"),
    projectId: id,
    ...featureFields,
  }),
  z.object({ type: z.literal("feature.update"), id, ...featureFields }),
  z.object({ type: z.literal("feature.rename"), id, name }),
  z.object({ type: z.literal("feature.delete"), id }),
  z.object({ type: z.literal("feature.pin"), id, pinned: z.boolean() }),
  z.object({
    type: z.literal("feature.reorder"),
    projectId: id,
    ids: z.array(id).min(1).max(10000),
  }),
  z.object({
    type: z.literal("status.create"),
    projectId: id,
    ...statusFields,
  }),
  z.object({ type: z.literal("status.update"), id, ...statusFields }),
  z.object({ type: z.literal("status.delete"), id }),
  z.object({
    type: z.literal("status.reorder"),
    projectId: id,
    ids: z.array(id).min(1).max(200),
  }),
  z.object({
    type: z.literal("task.create"),
    projectId: id,
    ...taskFields,
    ticketIds: z.array(id).max(1000).optional(),
    leaderId: id.optional(),
    teamMemberIds: z.array(id).max(1000).optional(),
  }),
  z.object({
    type: z.literal("task.assignment.update"),
    id,
    leaderId: id,
    teamMemberIds: z.array(id).max(1000),
  }),
  z.object({ type: z.literal("module.leader.update"), id, userId: id }),
  z.object({ type: z.literal("feature.leader.update"), id, userId: id }),
  z.object({
    type: z.literal("settings.update"),
    maxAttachmentBytes: z.number().int().min(1048576).max(104857600),
  }),
  z.object({ type: z.literal("task.update"), id, ...taskFields }),
  z.object({
    type: z.literal("task.clients.update"),
    id,
    clientIds: z.array(id).max(1000),
  }),
  z.object({ type: z.literal("task.rename"), id, title: taskTitle }),
  z.object({
    type: z.literal("task.move"),
    id,
    statusId: id,
    beforeId: id.nullable(),
  }),
  z.object({ type: z.literal("task.archive"), id, archived: z.boolean() }),
  z.object({ type: z.literal("task.delete"), id }),
  z.object({
    type: z.literal("priority.create"),
    projectId: id,
    name: name.max(60),
    color,
  }),
  z.object({
    type: z.literal("priority.update"),
    projectId: id,
    id,
    name: name.max(60),
    color,
  }),
  z.object({ type: z.literal("priority.delete"), projectId: id, id }),
  ...(["taskType", "impact", "application"] as const).flatMap((kind) => [
    z.object({
      type: z.literal(`${kind}.create`),
      projectId: id,
      name: name.max(60),
      color,
    }),
    z.object({
      type: z.literal(`${kind}.update`),
      projectId: id,
      id,
      name: name.max(60),
      color,
    }),
    z.object({ type: z.literal(`${kind}.delete`), projectId: id, id }),
  ]),
  z.object({
    type: z.literal("label.create"),
    projectId: id,
    name: name.max(60),
    color,
  }),
  z.object({
    type: z.literal("label.update"),
    projectId: id,
    id,
    name: name.max(60),
    color,
  }),
  z.object({ type: z.literal("label.delete"), projectId: id, id }),
  z.object({ type: z.literal("checklist.create"), taskId: id, title: name }),
  z.object({ type: z.literal("checklist.update"), id, title: name }),
  z.object({ type: z.literal("checklist.delete"), id }),
  z.object({
    type: z.literal("checklist.item.create"),
    checklistId: id,
    title: taskTitle,
  }),
  z.object({
    type: z.literal("checklist.item.update"),
    id,
    title: taskTitle,
    completed: z.boolean(),
  }),
  z.object({ type: z.literal("checklist.item.delete"), id }),
  z.object({
    type: z.literal("comment.create"),
    taskId: id.optional(),
    scope: entityRefSchema.optional(),
    content: z.string().trim().min(1).max(10000),
    requestId: z.uuid().optional(),
  }),
  z.object({
    type: z.literal("comment.update"),
    id,
    content: z.string().trim().min(1).max(10000),
  }),
  z.object({ type: z.literal("comment.delete"), id }),
  z.object({
    type: z.literal("trello.import"),
    projectId: id.nullable(),
    board: trelloSchema,
  }),
]);
// Normalize requests from tabs opened before the terminology change.
export const commandSchema = z.preprocess(
  (input) => {
    if (!input || typeof input !== "object" || Array.isArray(input))
      return input;
    const command = input as Record<string, unknown>;
    if (Object.hasOwn(command, "ticketNumber"))
      return { ...command, type: "__outdated_ticket_field__" };
    const legacyType = String(command.type);
    if (/^(project|module|feature)\.transferOwnership$/.test(legacyType))
      return {
        ...command,
        type: legacyType.replace(".transferOwnership", ".leader.update"),
      };
    if (/^project\.member\.(add|remove)$/.test(legacyType))
      return { ...command, type: legacyType.replace(".member.", ".team.") };

    if (
      ![
        "task.create",
        "task.assignment.update",
        "task.participants.update",
      ].includes(String(command.type))
    )
      return input;
    return {
      ...command,
      type:
        command.type === "task.participants.update"
          ? "task.assignment.update"
          : command.type,
      ...(!Object.hasOwn(command, "leaderId") &&
      Object.hasOwn(command, "assigneeId")
        ? { leaderId: command.assigneeId }
        : {}),
      ...(!Object.hasOwn(command, "teamMemberIds") &&
      Object.hasOwn(command, "collaboratorIds")
        ? { teamMemberIds: command.collaboratorIds }
        : {}),
    };
  },
  currentCommandSchema.refine(
    (c) => c.type !== "comment.create" || !!c.taskId !== !!c.scope,
    "Indica un único destino para el comentario.",
  ),
);
export type Command = z.infer<typeof commandSchema>;
