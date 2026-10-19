import { z } from "zod";
import type { Client, EntityKind, Ticket } from "./types";
import { paginationSchema, type PageQuery } from "./pagination";

export const WITHOUT_CLIENT = "__without_client__";
export const ticketPageSchema = paginationSchema.extend({
  clientId: z.string().trim().min(1).max(200).optional(),
  withoutClient: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
}).refine((value) => !(value.clientId && value.withoutClient), "Elige un cliente o tickets sin cliente.");
export type TicketPageQuery = PageQuery & { clientId?: string; withoutClient?: boolean };

export interface CatalogTicket extends Ticket {
  client: Client | null;
}

export interface TicketLink {
  kind: EntityKind;
  id: string;
  name: string;
  projectName: string;
  href: string;
}
