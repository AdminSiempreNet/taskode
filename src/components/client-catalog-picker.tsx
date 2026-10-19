"use client";

import { useEffect, useState, type RefObject } from "react";
import type { Client } from "@/lib/types";
import { fetchJSON } from "@/lib/http-client";
import { initialPage, type Paginated } from "@/lib/pagination";
import { SearchCombobox, type SearchOption } from "./search-combobox";
import { Pagination } from "./pagination";
import { usePaginatedList } from "./use-paginated-list";
import { Button } from "./ui/button";

export function ClientCatalogPicker({ id, clients, value, change, disabled, create, triggerRef,
  label = "Cliente del ticket", placeholder = "Sin cliente", clearLabel = "Sin cliente", extraOptions = [],
}: {
  id: string; clients: Client[]; value: string; change: (id: string) => void;
  disabled?: boolean; create?: (name: string) => void; triggerRef?: RefObject<HTMLButtonElement | null>;
  label?: string; placeholder?: string; clearLabel?: string; extraOptions?: SearchOption[];
}) {
  const [open, setOpen] = useState(false);
  const list = usePaginatedList<Client>("/api/clients", initialPage(clients), open);
  const [selected, setSelected] = useState<Client | null>(null);
  const [lookupError, setLookupError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const known = clients.find((client) => client.id === value) ?? list.data.items.find((client) => client.id === value);
  const extra = extraOptions.find((option) => option.id === value);
  useEffect(() => {
    if (!value || known || extra) { setLookupError(""); return; }
    const abort = new AbortController();
    setLookupError("");
    void fetchJSON<Paginated<Client>>(`/api/clients?selectedId=${encodeURIComponent(value)}`, { signal: abort.signal })
      .then((page) => { if (!abort.signal.aborted) setSelected(page.items[0] ?? null); })
      .catch((error) => { if (!abort.signal.aborted) setLookupError(error.message); });
    return () => abort.abort();
  }, [value, known, extra?.id, attempt]);
  const current = known ?? (selected?.id === value ? selected : null);
  const option = (client: Client) => ({ id: client.id, name: client.name, secondary: `${client.cityName} · ${client.departmentName}` });
  return <SearchCombobox id={id} label={label} options={[...extraOptions, ...list.data.items.map(option)]}
    selectedOptions={extra ? [extra] : current ? [option(current)] : value ? [{ id: value, name: "Cliente seleccionado" }] : []}
    values={value ? [value] : []} onChange={(ids) => change(ids[0] ?? "")} disabled={disabled} loading={list.loading}
    placeholder={placeholder} clearLabel={clearLabel} required={false} triggerRef={triggerRef} onCreate={create}
    onSearchChange={list.search} onOpenChange={setOpen} searchPlaceholder="Buscar cliente, ciudad o departamento…"
    footer={<div className="catalog-combobox-pagination">
      {(list.error || lookupError) && <p role="alert">{list.error || lookupError} <Button type="button" variant="ghost" onClick={() => { list.refresh(); setAttempt((n) => n + 1); }}>Reintentar</Button></p>}
      <Pagination {...list.data} changePage={list.changePage} changePageSize={list.changePageSize} disabled={disabled || list.loading} label="Paginación de opciones de clientes" compact />
    </div>} />;
}
