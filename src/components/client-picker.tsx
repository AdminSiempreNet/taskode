"use client";

import { useRef, useState } from "react";
import { X } from "lucide-react";
import type { Client } from "@/lib/types";
import type { Mutate } from "./forms";
import { ClientFormDialog } from "./client-form";
import { SearchCombobox } from "./search-combobox";
import { Button } from "./ui/button";

export function ClientPicker({
  id,
  clients,
  values,
  onChange,
  mutate,
  busy,
}: {
  id: string;
  clients: Client[];
  values: string[];
  onChange: (values: string[]) => void;
  mutate: Mutate;
  busy: boolean;
}) {
  const [creating, setCreating] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <div className="client-picker">
      <SearchCombobox
        id={id}
        label="Clientes"
        multiple
        options={clients.map((client) => ({
          id: client.id,
          name: client.name,
          secondary: `${client.cityName} · ${client.departmentName}`,
        }))}
        values={values}
        onChange={onChange}
        disabled={busy}
        onCreate={setCreating}
        triggerRef={trigger}
      />
      {!!values.length && (
        <ul className="task-client-list" aria-label="Clientes asignados">
          {values.map((value) => {
            const client = clients.find((client) => client.id === value);
            return (
              <li key={value}>
                <div className="client-option-text">
                  <span>{client?.name ?? "Cliente eliminado"}</span>
                  {client && (
                    <small>
                      {client.cityName} · {client.departmentName}
                    </small>
                  )}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={busy}
                  aria-label={`Quitar cliente ${client?.name ?? "eliminado"}`}
                  onClick={() => onChange(values.filter((id) => id !== value))}
                >
                  <X size={14} />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {creating !== null && (
        <ClientFormDialog
          initialName={creating}
          mutate={mutate}
          busy={busy}
          close={() => setCreating(null)}
          returnFocus={trigger}
          saved={(id) => onChange([...new Set([...values, id])])}
        />
      )}
    </div>
  );
}
