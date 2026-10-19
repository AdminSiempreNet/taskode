"use client";

import { useRef, useState } from "react";
import { Pencil, Plus, Search, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import type { Client } from "@/lib/types";
import { initialPage as createInitialPage, type Paginated } from "@/lib/pagination";
import { Pagination } from "./pagination";
import { usePaginatedList } from "./use-paginated-list";
import { ClientFormDialog } from "./client-form";
import type { Confirmation, Mutate } from "./forms";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export function ClientsManager({
  clients,
  mutate,
  busy,
  confirm,
  initialPage,
}: {
  clients: Client[];
  mutate: Mutate;
  busy: boolean;
  confirm: (confirmation: Confirmation) => void;
  initialPage?: Paginated<Client>;
}) {
  const list = usePaginatedList<Client>("/api/clients", initialPage ?? createInitialPage(clients));
  const [editing, setEditing] = useState<Client | "new" | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const filtered = list.error ? [] : list.data.items;
  const mutateCatalog: Mutate = async (command) => {
    const result = await mutate(command);
    if (result) list.refresh();
    return result;
  };
  return (
    <section className="clients-page" aria-labelledby="clients-title">
      <header className="clients-header">
        <div>
          <h1 id="clients-title">
            <Users size={24} />
            Clientes
          </h1>
          <p>Un catálogo compartido para todos tus proyectos.</p>
        </div>
        <Button
          disabled={busy}
          onClick={(event) => {
            opener.current = event.currentTarget;
            setEditing("new");
          }}
        >
          <Plus size={16} />
          Nuevo cliente
        </Button>
      </header>
      <div className="search-field clients-search">
        <Search size={16} />
        <Input
          aria-label="Buscar clientes"
          placeholder="Buscar por nombre, ciudad o departamento…"
          value={list.query}
          maxLength={200}
          onChange={(event) => list.search(event.target.value)}
        />
      </div>
      {list.loading && <p role="status" className="field-hint">Cargando clientes…</p>}
      {list.error && <p role="alert">{list.error} <Button variant="outline" onClick={list.refresh}>Reintentar</Button></p>}
      {filtered.length ? (
        <div className="clients-table-scroll" aria-busy={list.loading}>
          <table className="clients-table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Ciudad</th>
                <th>Departamento</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((client) => (
                <tr key={client.id}>
                  <td>{client.name}</td>
                  <td>{client.cityName}</td>
                  <td>{client.departmentName}</td>
                  <td className="clients-row-actions">
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={busy || list.loading}
                      aria-label={`Editar cliente ${client.name}`}
                      onClick={(event) => {
                        opener.current = event.currentTarget;
                        setEditing(client);
                      }}
                    >
                      <Pencil size={15} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={busy || list.loading}
                      aria-label={`Eliminar cliente ${client.name}`}
                      onClick={() =>
                        confirm({
                          title: `Eliminar «${client.name}»`,
                          description:
                            "Solo se puede eliminar si no tiene proyectos, módulos, features, tareas o tickets relacionados. Esta acción no se puede deshacer.",
                          action: async () => {
                            if (
                              await mutateCatalog({
                                type: "client.delete",
                                id: client.id,
                              })
                            )
                              toast.success("Cliente eliminado.");
                          },
                        })
                      }
                    >
                      <Trash2 size={15} />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : !list.loading && !list.error ? (
        <p className="clients-empty">
          {list.query
            ? "No se encontraron clientes."
            : "Aún no hay clientes. Crea el primero para relacionarlo con proyectos, módulos, features o tareas."}
        </p>
      ) : null}
      <Pagination {...list.data} changePage={list.changePage} changePageSize={list.changePageSize} disabled={busy || list.loading} label="Paginación de clientes" />
      {editing && (
        <ClientFormDialog
          client={editing === "new" ? undefined : editing}
          mutate={mutateCatalog}
          busy={busy}
          close={() => setEditing(null)}
          returnFocus={opener}
        />
      )}
    </section>
  );
}
