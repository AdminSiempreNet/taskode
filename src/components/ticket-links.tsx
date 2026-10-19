"use client";

import { useId } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import type { EntityKind } from "@/lib/types";
import type { TicketLink } from "@/lib/catalogs";
import { usePaginatedList } from "./use-paginated-list";
import { Pagination } from "./pagination";
import { Button } from "./ui/button";

const groups: { kind: EntityKind; label: string; empty: string }[] = [
  { kind: "project", label: "Proyectos", empty: "Sin proyectos vinculados." },
  { kind: "module", label: "Módulos", empty: "Sin módulos vinculados." },
  { kind: "feature", label: "Features", empty: "Sin features vinculadas." },
  { kind: "task", label: "Tareas", empty: "Sin tareas vinculadas." },
];

function TicketLinkGroup({ ticketId, kind, label, empty }: typeof groups[number] & { ticketId: string }) {
  const title = useId();
  const list = usePaginatedList<TicketLink>(`/api/tickets/${encodeURIComponent(ticketId)}/links/${kind}`);
  return <section className="ticket-link-group" aria-labelledby={title} aria-busy={list.loading}>
    <h4 id={title}>{label} {!list.loading && !list.error && <span>({list.data.total})</span>}</h4>
    {list.loading && <p className="field-hint" role="status">Cargando {label.toLocaleLowerCase("es")}…</p>}
    {list.error ? <p role="alert">{list.error} <Button type="button" variant="ghost" onClick={list.refresh}>Reintentar</Button></p>
      : <>
        {!!list.data.items.length && <ul>
          {list.data.items.map((link) => <li key={link.id}>
            <Link href={link.href} target="_blank" rel="noopener noreferrer">
              <span><strong>{link.name}</strong>{kind !== "project" && <small>{link.projectName}</small>}</span>
              <ExternalLink size={13} aria-hidden="true" />
              <span className="sr-only"> (abrir en otra pestaña)</span>
            </Link>
          </li>)}
        </ul>}
        {!list.loading && !list.data.total && <p className="field-hint">{empty}</p>}
        {list.data.total > list.data.pageSize && <Pagination {...list.data} changePage={list.changePage} changePageSize={list.changePageSize}
          disabled={list.loading} label={`Paginación de ${label.toLocaleLowerCase("es")} vinculados`} compact />}
      </>}
  </section>;
}

export function TicketLinks({ ticketId }: { ticketId: string }) {
  const title = useId();
  return <aside className="ticket-linked-items" aria-labelledby={title}>
    <h3 id={title}>Vinculado a</h3>
    <p className="field-hint">Asignaciones directas a elementos que puedes consultar.</p>
    {groups.map((group) => <TicketLinkGroup key={group.kind} ticketId={ticketId} {...group} />)}
  </aside>;
}
