"use client";

import { useEffect, useId, useState, type RefObject } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { Client, Geography } from "@/lib/types";
import { fetchJSON } from "@/lib/http-client";
import type { Mutate } from "./forms";
import { SearchCombobox } from "./search-combobox";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

export function ClientFormDialog({
  client,
  initialName = "",
  mutate,
  busy,
  close,
  saved,
  returnFocus,
}: {
  client?: Client;
  initialName?: string;
  mutate: Mutate;
  busy: boolean;
  close: () => void;
  saved?: (id: string) => void;
  returnFocus?: RefObject<HTMLButtonElement | null>;
}) {
  const prefix = useId();
  const [name, setName] = useState(client?.name ?? initialName.slice(0, 160));
  const [cityId, setCityId] = useState(client?.cityId ?? "");
  const [geography, setGeography] = useState<Geography | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let disposed = false;
    setError("");
    fetchJSON<Geography>("/api/geography")
      .then((data) => {
        if (!disposed) setGeography(data);
      })
      .catch((error) => {
        if (!disposed)
          setError(
            error instanceof Error
              ? error.message
              : "No se pudieron cargar las ciudades.",
          );
      });
    return () => {
      disposed = true;
    };
  }, [attempt]);
  const departmentNames = new Map(
    geography?.departments.map((department) => [
      department.id,
      department.name,
    ]),
  );
  const city = geography?.cities.find((city) => city.id === cityId);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
    >
      <DialogContent
        className="client-form-dialog"
        onCloseAutoFocus={(event) => {
          if (returnFocus) {
            event.preventDefault();
            returnFocus.current?.focus();
          }
        }}
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {client ? "Editar cliente" : "Nuevo cliente"}
          </DialogTitle>
          <DialogDescription>
            Disponible en todos los proyectos. Nombre y ciudad son obligatorios.
          </DialogDescription>
        </DialogHeader>
        <form
          className="client-form"
          onSubmit={async (event) => {
            event.preventDefault();
            // Dialog portals still bubble React events through the task form.
            event.stopPropagation();
            if (busy || !name.trim() || !city) return;
            const result = await mutate(
              client
                ? { type: "client.update", id: client.id, name, cityId }
                : { type: "client.create", name, cityId },
            );
            if (!result) return;
            toast.success(client ? "Cliente actualizado." : "Cliente creado.");
            saved?.(client?.id ?? result.createdId!);
            close();
          }}
        >
          <div className="field">
            <Label htmlFor={`${prefix}-name`}>Nombre</Label>
            <Input
              id={`${prefix}-name`}
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={160}
              required
              autoFocus
              disabled={busy}
            />
          </div>
          <div className="field">
            <Label htmlFor={`${prefix}-city`}>Ciudad</Label>
            <SearchCombobox
              id={`${prefix}-city`}
              label="Ciudades"
              options={(geography?.cities ?? []).map((city) => ({
                id: city.id,
                name: city.name,
                group: departmentNames.get(city.departmentId),
              }))}
              values={cityId ? [cityId] : []}
              onChange={(values) => setCityId(values[0])}
              disabled={busy || !geography}
            />
          </div>
          {!geography && !error && (
            <p role="status" className="field-hint">
              Cargando ciudades…
            </p>
          )}
          {error && (
            <div role="alert">
              <p>{error}</p>
              <Button
                type="button"
                variant="outline"
                onClick={() => setAttempt((value) => value + 1)}
              >
                Reintentar
              </Button>
            </div>
          )}
          <div className="field">
            <Label htmlFor={`${prefix}-department`}>Departamento</Label>
            <Input
              id={`${prefix}-department`}
              readOnly
              value={city ? (departmentNames.get(city.departmentId) ?? "") : ""}
              placeholder="Se completa al elegir la ciudad"
            />
          </div>
          <div className="client-form-actions">
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={close}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={busy || !city || !name.trim()}>
              {busy && <Loader2 className="animate-spin" />}{" "}
              {client ? "Guardar cambios" : "Crear cliente"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
