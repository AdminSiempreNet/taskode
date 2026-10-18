import { z } from "zod";

export const REMINDER_OFFSETS = [15, 60, 1440, 4320, 10080] as const;
export const notificationPreferencesSchema = z.object({
  offsets: z
    .array(
      z
        .number()
        .refine((v) =>
          REMINDER_OFFSETS.includes(v as (typeof REMINDER_OFFSETS)[number]),
        ),
    )
    .max(3)
    .refine((v) => new Set(v).size === v.length, "No repitas anticipaciones."),
  dateOnlyTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora inválida."),
});
export type NotificationPreferences = z.infer<
  typeof notificationPreferencesSchema
>;
export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  offsets: [1440, 60],
  dateOnlyTime: "08:00",
};
export interface NotificationItem {
  id: string;
  sequence?: number;
  type: "assigned" | "shared" | "reminder";
  actorName: string | null;
  taskId: string;
  projectId: string;
  projectName: string;
  taskTitle: string;
  offsetMinutes: number | null;
  createdAt: string;
  readAt: string | null;
}
export interface NotificationsSnapshot {
  items: NotificationItem[];
  unreadCount: number;
  nextCursor: string | null;
  through: string | null;
  realtime: { enabled: boolean; channel: string | null };
}
export function notificationText(item: NotificationItem) {
  if (item.type === "assigned")
    return `${item.actorName ?? "Alguien"} te asignó una tarea`;
  if (item.type === "shared")
    return `${item.actorName ?? "Alguien"} compartió una tarea contigo`;
  return "Una tarea está próxima a vencer";
}
export const offsetLabel = (minutes: number) =>
  ({
    15: "15 minutos",
    60: "1 hora",
    1440: "1 día",
    4320: "3 días",
    10080: "1 semana",
  })[minutes] ?? "";
