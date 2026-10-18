"use client";
import { useEffect, useState } from "react";
import { GitBranch, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { entityNames } from "@/lib/entities";
import type { EntityRef } from "@/lib/types";
import type { DocumentDiagramOption } from "@/lib/documents";
import styles from "./documents.module.css";

export function DocumentDiagramPicker({
  scope,
  open,
  onClose,
  onSelect,
}: {
  scope: EntityRef;
  open: boolean;
  onClose: () => void;
  onSelect: (diagram: DocumentDiagramOption) => void;
}) {
  const [diagrams, setDiagrams] = useState<DocumentDiagramOption[]>();
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const filtered =
    diagrams?.filter((diagram) =>
      `${diagram.title} ${diagram.description}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    ) ?? [];
  const groups = [
    ...new Set(
      filtered.map((diagram) => `${diagram.scope.kind}:${diagram.scope.id}`),
    ),
  ];
  useEffect(() => {
    if (!open) return;
    let active = true;
    setDiagrams(undefined);
    setError("");
    setQuery("");
    fetch(
      `/api/entities/${scope.kind}/${encodeURIComponent(scope.id)}/document-diagrams`,
      { cache: "no-store" },
    )
      .then(async (response) => {
        const value = await response.json();
        if (!response.ok)
          throw new Error(
            value.error || "No se pudieron cargar los diagramas.",
          );
        return value;
      })
      .then((value) => {
        if (active) setDiagrams(value.diagrams);
      })
      .catch((error) => {
        if (active) setError(error.message);
      });
    return () => {
      active = false;
    };
  }, [scope.kind, scope.id, open, retry]);
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <DialogContent data-document-picker>
        <DialogTitle>Insertar diagrama</DialogTitle>
        <DialogDescription>
          Elige un diagrama de este elemento o de sus antecesores.
        </DialogDescription>
        <Input
          aria-label="Buscar diagramas"
          placeholder="Buscar por título o descripción…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {error ? (
          <div role="alert">
            {error}
            <Button
              variant="outline"
              onClick={() => setRetry((value) => value + 1)}
            >
              Reintentar
            </Button>
          </div>
        ) : !diagrams ? (
          <Loader2 className="animate-spin" />
        ) : (
          <div className={styles.pickerList}>
            {!filtered.length && <p>No hay diagramas disponibles.</p>}
            {groups.map((group) => (
              <section key={group}>
                <h3>
                  {
                    entityNames[
                      filtered.find(
                        (diagram) =>
                          `${diagram.scope.kind}:${diagram.scope.id}` === group,
                      )!.scope.kind
                    ]
                  }
                </h3>
                {filtered
                  .filter(
                    (diagram) =>
                      `${diagram.scope.kind}:${diagram.scope.id}` === group,
                  )
                  .map((diagram) => (
                    <button
                      type="button"
                      key={diagram.id}
                      onClick={() => onSelect(diagram)}
                    >
                      <GitBranch size={19} />
                      <span>
                        <strong>{diagram.title}</strong>
                        <small>
                          {diagram.scope.kind === scope.kind &&
                          diagram.scope.id === scope.id
                            ? "Este elemento"
                            : entityNames[diagram.scope.kind]}{" "}
                          · {diagram.description || "Sin descripción"}
                        </small>
                      </span>
                    </button>
                  ))}
              </section>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
