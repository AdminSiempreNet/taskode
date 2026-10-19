import { z } from "zod";
import type { Client, Ticket } from "./types";
import { normalizeClientText } from "./clients";

export const ticketInputSchema = z.object({
  number: z.string().trim().min(1, "Escribe el número del ticket.").max(100),
  description: z.string().max(30000).default(""),
  url: z.string().trim().max(2048).refine((value) => {
    if (!value) return true;
    try { return ["http:", "https:"].includes(new URL(value).protocol); }
    catch { return false; }
  }, "Escribe un enlace HTTP o HTTPS válido.").nullish().transform((value) => value || null),
  clientId: z.string().min(1).max(200).nullish().transform((value) => value ?? null),
});

export function ticketSearchText(ticket: Ticket, clients: Client[]) {
  return normalizeClientText(`${ticket.number} ${ticket.description} ${ticket.url ?? ""} ${clients.find((client) => client.id === ticket.clientId)?.name ?? ""}`);
}

