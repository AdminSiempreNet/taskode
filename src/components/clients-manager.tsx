"use client";

import { useRef, useState } from "react";
import { Pencil, Plus, Search, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import type { Client } from "@/lib/types";
import { normalizeClientText } from "@/lib/clients";
import { ClientFormDialog } from "./client-form";
import type { Confirmation, Mutate } from "./forms";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export function ClientsManager({
  clients,
  mutate,
  busy,
  confirm,
}: {
  clients: Client[];
  mutate: Mutate;
  busy: boolean;
  confirm: (confirmation: Confirmation) => void;
}) {
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Client | "new" | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const filtered = clients.filter((client) =>
    normalizeClientText(
      `${client.name} ${client.cityName} ${client.departmentName}`,
    ).includes(normalizeClientText(search)),
  );
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
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      {filtered.length ? (
        <div className="clients-table-scroll">
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
                      disabled={busy}
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
                      disabled={busy}
                      aria-label={`Eliminar cliente ${client.name}`}
                      onClick={() =>
                        confirm({
                          title: `Eliminar «${client.name}»`,
                          description:
                            "Solo se puede eliminar si no tiene tareas relacionadas. Esta acción no se puede deshacer.",
                          action: async () => {
                            if (
                              await mutate({
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
      ) : (
        <p className="clients-empty">
          {search
            ? "No se encontraron clientes."
            : "Aún no hay clientes. Crea el primero para relacionarlo con tus tareas."}
        </p>
      )}
      {editing && (
        <ClientFormDialog
          client={editing === "new" ? undefined : editing}
          mutate={mutate}
          busy={busy}
          close={() => setEditing(null)}
          returnFocus={opener}
        />
      )}
    </section>
  );
}
