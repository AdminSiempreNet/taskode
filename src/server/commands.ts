import { commandSchema, type Command } from "../lib/validation";
import type { Actor } from "../lib/types";
import { deliverCommentEvents } from "./comment-http";
import { deliverNotificationEvents } from "./notification-http";
import type { PostgresRepository } from "./postgres";

// Outbox rows are written inside the domain transaction; these drain them after the response.
export interface Effects {
  notifications(): void;
  comments(): void;
}
export const httpEffects: Effects = {
  notifications: deliverNotificationEvents,
  comments: deliverCommentEvents,
};
const NOTIFYING = /^(task\.|project\.|module\.|feature\.|comment\.|status\.update|trello\.)/;
export function deliverCommandEffects(type: Command["type"], effects: Effects = httpEffects) {
  if (NOTIFYING.test(type)) effects.notifications();
  if (type.startsWith("comment.")) effects.comments();
}
// Shared by POST /api/workspace and the MCP tools: same validation, permissions and side effects.
export async function runCommand(
  repo: PostgresRepository,
  input: unknown,
  actor: Actor,
  effects: Effects = httpEffects,
) {
  const command = commandSchema.parse(input);
  const result = await repo.execute(command, actor);
  deliverCommandEffects(command.type, effects);
  return result;
}
