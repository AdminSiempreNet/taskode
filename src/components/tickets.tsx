"use client";

import { useId, useRef, useState, type RefObject } from "react";
import { ExternalLink, Loader2, Pencil, Plus, Search, Ticket as TicketIcon, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import type { Client, EntityRef, Ticket } from "@/lib/types";
import { ticketInputSchema } from "@/lib/tickets";
import { WITHOUT_CLIENT, type CatalogTicket } from "@/lib/catalogs";
import { initialPage as createInitialPage, type Paginated } from "@/lib/pagination";
import { Pagination } from "./pagination";
import { usePaginatedList } from "./use-paginated-list";
import { ClientCatalogPicker } from "./client-catalog-picker";
import { TicketLinks } from "./ticket-links";
import type { Confirmation, Mutate } from "./forms";
import { ClientFormDialog } from "./client-form";
import { SearchCombobox } from "./search-combobox";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";

export function TicketFormDialog({ ticket, initialNumber = "", clients, scope, mutate, busy, close, saved, returnFocus }: {
  ticket?: Ticket; initialNumber?: string; clients: Client[]; scope?: EntityRef;
  mutate: Mutate; busy: boolean; close: () => void; saved?: (id: string, clientId: string | null) => void;
  returnFocus?: RefObject<HTMLButtonElement | null>;
}) {
  const prefix = useId();
  const [number, setNumber] = useState(ticket?.number ?? initialNumber.slice(0, 100));
  const [description, setDescription] = useState(ticket?.description ?? "");
  const [url, setUrl] = useState(ticket?.url ?? "");
  const [clientId, setClientId] = useState(ticket?.clientId ?? "");
  const [creatingClient, setCreatingClient] = useState<string | null>(null);
  const [error, setError] = useState("");
  const clientTrigger = useRef<HTMLButtonElement>(null);
  return <>
    <Dialog open onOpenChange={(open) => { if (!open && !busy) close(); }}>
      <DialogContent className={`client-form-dialog${ticket ? " sm:max-w-3xl" : ""}`} onCloseAutoFocus={(event) => {
        if (returnFocus) { event.preventDefault(); returnFocus.current?.focus(); }
      }} onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }} onInteractOutside={(event) => { if (busy) event.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle>{ticket ? "Editar ticket" : "Nuevo ticket"}</DialogTitle>
          <DialogDescription>Disponible en todos los proyectos. Solo el número es obligatorio.</DialogDescription>
        </DialogHeader>
        <form className="client-form" onSubmit={async (event) => {
          event.preventDefault(); event.stopPropagation();
          if (busy) return;
          const parsed = ticketInputSchema.safeParse({ number, description, url, clientId: clientId || null });
          if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
          setError("");
          const result = await mutate(ticket ? { type: "ticket.update", id: ticket.id, ...parsed.data } : { type: "ticket.create", ...parsed.data, scope });
          if (!result) return;
          toast.success(ticket ? "Ticket actualizado." : "Ticket creado.");
          saved?.(ticket?.id ?? result.createdId!, parsed.data.clientId); close();
        }}>
          <div className={ticket ? "ticket-edit-layout" : undefined}>
          <div className="client-form">
          <div className="field"><Label htmlFor={`${prefix}-number`}>Número del ticket</Label>
            <Input id={`${prefix}-number`} value={number} onChange={(event) => setNumber(event.target.value)} maxLength={100} required autoFocus disabled={busy} />
          </div>
          <div className="field"><Label htmlFor={`${prefix}-description`}>Descripción</Label>
            <Textarea id={`${prefix}-description`} value={description} onChange={(event) => setDescription(event.target.value)} maxLength={30000} rows={4} disabled={busy} />
          </div>
          <div className="field"><Label htmlFor={`${prefix}-url`}>Enlace</Label>
            <Input id={`${prefix}-url`} type="url" placeholder="https://…" value={url} onChange={(event) => setUrl(event.target.value)} maxLength={2048} disabled={busy} />
          </div>
          <div className="field"><Label htmlFor={`${prefix}-client`}>Cliente</Label>
            <ClientCatalogPicker id={`${prefix}-client`} clients={clients} value={clientId} change={setClientId}
              create={setCreatingClient} triggerRef={clientTrigger} disabled={busy} />
          </div>
          {ticket && <p className="field-hint">El nuevo cliente se agregará a los elementos con este ticket. Los clientes anteriores se conservan.</p>}
          </div>
          {ticket && <TicketLinks key={ticket.id} ticketId={ticket.id} />}
          </div>
          {error && <p role="alert">{error}</p>}
          <div className="client-form-actions">
            <Button type="button" variant="ghost" onClick={close} disabled={busy}>Cancelar</Button>
            <Button type="submit" disabled={busy || !number.trim()}>{busy && <Loader2 className="animate-spin" />}{ticket ? "Guardar cambios" : "Crear ticket"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
    {creatingClient !== null && <ClientFormDialog initialName={creatingClient} mutate={mutate} busy={busy} close={() => setCreatingClient(null)} returnFocus={clientTrigger} saved={setClientId} />}
  </>;
}

function ticketRemoval(ticket: Ticket, mutate: Mutate, deleted?: () => void): Confirmation {
  return { title: `Eliminar ticket «${ticket.number}»`, description: "Se eliminará del catálogo global. Primero debes quitar todas sus asignaciones. Esta acción no se puede deshacer.",
    action: async () => { if (await mutate({ type: "ticket.delete", id: ticket.id })) { deleted?.(); toast.success("Ticket eliminado."); } } };
}

export function TicketPicker({ id, tickets, clients, values, onChange, mutate, busy, scope, confirm }: {
  id: string; tickets: Ticket[]; clients: Client[]; values: string[]; onChange: (ids: string[], addedClientId?: string | null) => void;
  mutate: Mutate; busy: boolean; scope?: EntityRef; confirm: (value: Confirmation) => void;
}) {
  const [editing, setEditing] = useState<Ticket | string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  return <div className="ticket-picker">
    <SearchCombobox id={id} label="Tickets" multiple options={tickets.map((ticket) => ({ id: ticket.id, name: ticket.number,
      secondary: `${clients.find((client) => client.id === ticket.clientId)?.name ?? "Sin cliente"} · ${ticket.description || ticket.url || "Sin descripción"} · ${ticket.id.slice(-8)}` }))}
      values={values} onChange={onChange} disabled={busy} onCreate={(query) => { opener.current = trigger.current; setEditing(query); }} triggerRef={trigger}
      placeholder="Agregar ticket…" searchPlaceholder="Buscar por número, descripción o cliente…" createLabel="Crear ticket" />
    {!!values.length && <ul className="task-client-list ticket-assignment-list" aria-label="Tickets asignados">
      {values.map((value) => {
        const ticket = tickets.find((ticket) => ticket.id === value);
        return <li key={value}>
          <div className="client-option-text"><strong>{ticket?.number ?? "Ticket eliminado"}</strong>
            {ticket && <><small>{clients.find((client) => client.id === ticket.clientId)?.name ?? "Sin cliente"}</small>
              {ticket.description && <p className="ticket-description">{ticket.description}</p>}
              {ticket.url && <a href={ticket.url} target="_blank" rel="noopener noreferrer" className="ticket-link"><ExternalLink size={13} />Abrir ticket</a>}
            </>}
          </div>
          <div className="ticket-actions">
            {ticket && <><Button type="button" variant="ghost" size="icon" disabled={busy} aria-label={`Editar ticket ${ticket.number}`} onClick={(event) => { opener.current = event.currentTarget; setEditing(ticket); }}><Pencil size={14} /></Button>
              <Button type="button" variant="ghost" size="icon" disabled={busy} aria-label={`Eliminar ticket ${ticket.number} del catálogo`} onClick={() => confirm(ticketRemoval(ticket, mutate, () => { if (!scope) onChange(values.filter((id) => id !== ticket.id)); }))}><Trash2 size={14} /></Button></>}
            <Button type="button" variant="ghost" size="icon" disabled={busy} aria-label={`Quitar ticket ${ticket?.number ?? "eliminado"}`} onClick={() => onChange(values.filter((id) => id !== value))}><X size={14} /></Button>
          </div>
        </li>;
      })}
    </ul>}
    {!values.length && <p className="field-hint">Sin tickets asignados. Al asignar uno también se agrega su cliente.</p>}
    {editing !== null && <TicketFormDialog ticket={typeof editing === "string" ? undefined : editing} initialNumber={typeof editing === "string" ? editing : undefined} clients={clients} scope={scope} mutate={mutate} busy={busy}
      close={() => setEditing(null)} returnFocus={opener} saved={(value, clientId) => { if (!scope && typeof editing === "string") onChange([...new Set([...values, value])], clientId); }} />}
  </div>;
}

export function TicketsManager({ tickets, clients, mutate, busy, confirm, initialPage }: {
  tickets: Ticket[]; clients: Client[]; mutate: Mutate; busy: boolean; confirm: (value: Confirmation) => void;
  initialPage?: Paginated<CatalogTicket>;
}) {
  const fallback = initialPage ?? { ...createInitialPage(tickets), items: createInitialPage(tickets).items.map((ticket) => ({ ...ticket, client: clients.find((client) => client.id === ticket.clientId) ?? null })) };
  const list = usePaginatedList<CatalogTicket>("/api/tickets", fallback);
  const [clientFilter, setClientFilter] = useState("");
  const [editing, setEditing] = useState<Ticket | "new" | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const filtered = list.error ? [] : list.data.items;
  const formClients = [...new Map([...clients, ...list.data.items.flatMap((ticket) => ticket.client ? [ticket.client] : [])].map((client) => [client.id, client])).values()];
  const mutateCatalog: Mutate = async (command) => { const result = await mutate(command); if (result) list.refresh(); return result; };
  return <section className="clients-page" aria-labelledby="tickets-title">
    <header className="clients-header"><div><h1 id="tickets-title"><TicketIcon size={24} />Tickets</h1><p>Un catálogo compartido para todos tus proyectos.</p></div>
      <Button disabled={busy} onClick={(event) => { opener.current = event.currentTarget; setEditing("new"); }}><Plus size={16} />Nuevo ticket</Button>
    </header>
    <div className="tickets-filters">
      <div className="search-field clients-search"><Search size={16} /><Input aria-label="Buscar tickets" placeholder="Buscar por número, descripción o cliente…" value={list.query} maxLength={200} onChange={(event) => list.search(event.target.value)} /></div>
      <div className="tickets-client-filter">
        <ClientCatalogPicker id="tickets-client-filter" label="Filtrar por cliente" clients={formClients} value={clientFilter} disabled={busy}
          placeholder="Todos los clientes" clearLabel="Todos los clientes" extraOptions={[{ id: WITHOUT_CLIENT, name: "Sin cliente" }]}
          change={(value) => {
            setClientFilter(value);
            list.changeFilters(value === WITHOUT_CLIENT ? { withoutClient: "true" } : value ? { clientId: value } : {});
          }} />
      </div>
    </div>
    {list.loading && <p role="status" className="field-hint">Cargando tickets…</p>}
    {list.error && <p role="alert">{list.error} <Button variant="outline" onClick={list.refresh}>Reintentar</Button></p>}
    {filtered.length ? <div className="clients-table-scroll" aria-busy={list.loading}><table className="clients-table tickets-table"><thead><tr><th>Número</th><th>Descripción</th><th>Cliente</th><th>Enlace</th><th>Acciones</th></tr></thead><tbody>
      {filtered.map((ticket) => <tr key={ticket.id}><td>{ticket.number}<small className="ticket-record-id">{ticket.id.slice(-8)}</small></td><td><p className="ticket-description">{ticket.description || "—"}</p></td><td>{ticket.client?.name ?? "Sin cliente"}</td>
        <td>{ticket.url ? <a href={ticket.url} target="_blank" rel="noopener noreferrer" className="ticket-link"><ExternalLink size={14} />Abrir</a> : "—"}</td>
        <td className="clients-row-actions"><Button variant="ghost" size="icon" disabled={busy || list.loading} aria-label={`Editar ticket ${ticket.number}`} onClick={(event) => { opener.current = event.currentTarget; setEditing(ticket); }}><Pencil size={15} /></Button>
          <Button variant="ghost" size="icon" disabled={busy || list.loading} aria-label={`Eliminar ticket ${ticket.number}`} onClick={() => confirm(ticketRemoval(ticket, mutateCatalog))}><Trash2 size={15} /></Button></td>
      </tr>)}
    </tbody></table></div> : !list.loading && !list.error ? <p className="clients-empty">{list.query || clientFilter ? "No se encontraron tickets." : "Aún no hay tickets. Crea el primero para asignarlo a un proyecto, módulo, feature o tarea."}</p> : null}
    <Pagination {...list.data} changePage={list.changePage} changePageSize={list.changePageSize} disabled={busy || list.loading} label="Paginación de tickets" />
    {editing && <TicketFormDialog ticket={editing === "new" ? undefined : editing} clients={formClients} mutate={mutateCatalog} busy={busy} close={() => setEditing(null)} returnFocus={opener} />}
  </section>;
}
