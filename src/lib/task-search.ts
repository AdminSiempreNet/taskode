import type { Task, Ticket } from "./types";

// Free-text task search shared by the board and the MCP tools: title, description, linked
// ticket numbers and labels, case-insensitive in Spanish.
export function taskMatchesText(
  task: Pick<Task, "title" | "description" | "ticketIds" | "labels">,
  tickets: Pick<Ticket, "id" | "number">[],
  search: string,
) {
  if (!search) return true;
  const numbers = tickets
    .filter((ticket) => task.ticketIds.includes(ticket.id))
    .map((ticket) => ticket.number)
    .join(" ");
  return `${task.title} ${task.description} ${numbers} ${task.labels.join(" ")}`
    .toLocaleLowerCase("es")
    .includes(search.toLocaleLowerCase("es"));
}
