"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Check,
  FileText,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import type { EntityPermissions, EntityRef } from "@/lib/types";
import type { DocumentDetail, DocumentSummary } from "@/lib/documents";
import { uploadFile } from "@/lib/file-client";
import { DescriptionEditor } from "./description-editor";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./ui/dialog";
import collection from "./diagrams.module.css";
import styles from "./documents.module.css";

export type DocumentPending = { pending: boolean; busy: boolean };
type Guard = (action: () => void) => void;
async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const value = await response.json();
  if (!response.ok)
    throw Object.assign(
      new Error(value.error || "No se pudo completar la operación."),
      { status: response.status },
    );
  return value;
}
function selectDocument(id: string | null) {
  const url = new URL(window.location.href);
  url.searchParams.set("tab", "documents");
  url.searchParams.delete("diagram");
  if (id) url.searchParams.set("document", id);
  else url.searchParams.delete("document");
  window.history.replaceState(null, "", `${url.pathname}${url.search}`);
}

export function EntityDocuments({
  scope,
  guard,
  onPendingChange,
}: {
  scope: EntityRef;
  guard: Guard;
  onPendingChange: (state: DocumentPending) => void;
}) {
  const selected = useSearchParams().get("document");
  const [listing, setListing] = useState<{
    documents: DocumentSummary[];
    permissions: EntityPermissions;
  }>();
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [remove, setRemove] = useState<DocumentSummary | null>(null);
  const endpoint = `/api/entities/${scope.kind}/${encodeURIComponent(scope.id)}/documents`;
  const load = useCallback(async () => {
    setError("");
    try {
      setListing(await api<NonNullable<typeof listing>>(endpoint));
    } catch (error) {
      setError((error as Error).message);
    }
  }, [endpoint]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!selected)
      onPendingChange({ pending: creating && !!(title || description), busy });
  }, [selected, creating, title, description, busy, onPendingChange]);
  useEffect(
    () => () => onPendingChange({ pending: false, busy: false }),
    [onPendingChange],
  );
  async function create(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const document = await api<DocumentDetail>(endpoint, {
        method: "POST",
        body: JSON.stringify({ title, description, content: "" }),
      });
      setCreating(false);
      setTitle("");
      setDescription("");
      selectDocument(document.id);
      void load();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (selected)
    return (
      <DocumentLoader
        key={selected}
        id={selected}
        scope={scope}
        guard={guard}
        onPendingChange={onPendingChange}
        onBack={() => {
          selectDocument(null);
          void load();
        }}
      />
    );
  return (
    <div className={collection.collection}>
      <header className={collection.collectionHeader}>
        <div>
          <h2>
            Documentos <span>{listing?.documents.length ?? 0}</span>
          </h2>
          <p>Escribe guías, decisiones y notas que dan contexto al trabajo.</p>
        </div>
        {listing?.permissions.canEdit && (
          <Button onClick={() => setCreating(true)}>
            <Plus size={16} />
            Nuevo documento
          </Button>
        )}
      </header>
      {!listing && !error && (
        <div className={collection.loading}>
          <Loader2 className="animate-spin" />
          Cargando documentos…
        </div>
      )}
      {error && (
        <div className={collection.empty}>
          <p role="alert">{error}</p>
          <Button variant="outline" onClick={() => void load()}>
            <RefreshCw />
            Reintentar
          </Button>
        </div>
      )}
      {listing && !listing.documents.length && (
        <div className={collection.empty}>
          <FileText size={42} />
          <h3>El contexto también forma parte del trabajo.</h3>
          <p>
            Crea el primer documento para reunir notas, explicaciones y
            diagramas.
          </p>
        </div>
      )}
      <div className={collection.grid}>
        {listing?.documents.map((document) => (
          <article key={document.id} className={collection.card}>
            <button
              className={collection.cardOpen}
              onClick={() => guard(() => selectDocument(document.id))}
            >
              <div className={collection.cardTop}>
                <span className={collection.cardIcon}>
                  <FileText size={23} />
                </span>
              </div>
              <h3>{document.title}</h3>
              <p>{document.description || "Sin descripción"}</p>
              <footer>
                <span>
                  Actualizado el{" "}
                  {new Date(document.updatedAt).toLocaleDateString("es-CO")}
                </span>
                <span>Abrir →</span>
              </footer>
            </button>
            {listing.permissions.canEdit && (
              <Button
                variant="ghost"
                size="sm"
                className={styles.deleteCard}
                aria-label={`Eliminar documento ${document.title}`}
                onClick={() => setRemove(document)}
              >
                <Trash2 size={15} />
              </Button>
            )}
          </article>
        ))}
      </div>
      <Dialog
        open={creating}
        onOpenChange={(open) => {
          if (!busy)
            guard(() => {
              setCreating(open);
              if (!open) {
                setTitle("");
                setDescription("");
              }
            });
        }}
      >
        <DialogContent>
          <DialogTitle>Nuevo documento</DialogTitle>
          <DialogDescription>
            Define el título y una descripción breve; después podrás escribir su
            contenido.
          </DialogDescription>
          <form onSubmit={create} className={collection.form}>
            <label>
              Título
              <Input
                autoFocus
                required
                maxLength={160}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={busy}
              />
            </label>
            <label>
              Descripción breve
              <Textarea
                maxLength={1000}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={busy}
              />
            </label>
            <div className={collection.formActions}>
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  guard(() => {
                    setCreating(false);
                    setTitle("");
                    setDescription("");
                  })
                }
              >
                Cancelar
              </Button>
              <Button disabled={busy || !title.trim()}>
                {busy ? <Loader2 className="animate-spin" /> : <Plus />}Crear
                documento
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!remove}
        onOpenChange={(open) => {
          if (!open && !busy) setRemove(null);
        }}
      >
        <DialogContent>
          <DialogTitle>¿Eliminar documento?</DialogTitle>
          <DialogDescription>
            Se eliminará «{remove?.title}». Los diagramas y archivos del
            elemento se conservarán.
          </DialogDescription>
          <div className={collection.formActions}>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setRemove(null)}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                if (!remove) return;
                setBusy(true);
                try {
                  await api(`/api/documents/${remove.id}`, {
                    method: "DELETE",
                  });
                  setRemove(null);
                  await load();
                  toast.success("Documento eliminado.");
                } catch (error) {
                  toast.error((error as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Eliminar documento
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DocumentLoader({
  id,
  scope,
  guard,
  onPendingChange,
  onBack,
}: {
  id: string;
  scope: EntityRef;
  guard: Guard;
  onPendingChange: (state: DocumentPending) => void;
  onBack: () => void;
}) {
  const [document, setDocument] = useState<DocumentDetail>();
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setError("");
    api<DocumentDetail>(`/api/documents/${encodeURIComponent(id)}`)
      .then((value) => {
        if (
          value.scope.kind !== scope.kind ||
          value.scope.id !== scope.id ||
          value.scope.projectId !== scope.projectId
        )
          throw new Error("Este documento no pertenece al elemento.");
        if (active) setDocument(value);
      })
      .catch((error) => {
        if (active) setError(error.message);
      });
    return () => {
      active = false;
    };
  }, [id, scope.kind, scope.id, scope.projectId, retry]);
  if (error)
    return (
      <div className={collection.empty}>
        <h3>Documento no disponible</h3>
        <p role="alert">{error}</p>
        <Button
          variant="outline"
          onClick={() => setRetry((value) => value + 1)}
        >
          Reintentar
        </Button>
        <Button variant="ghost" onClick={onBack}>
          Volver a documentos
        </Button>
      </div>
    );
  if (!document)
    return (
      <div className={collection.loading}>
        <Loader2 className="animate-spin" />
        Abriendo documento…
      </div>
    );
  return (
    <DocumentEditor
      initial={document}
      guard={guard}
      onPendingChange={onPendingChange}
      onBack={onBack}
    />
  );
}

function DocumentEditor({
  initial,
  guard,
  onPendingChange,
  onBack,
}: {
  initial: DocumentDetail;
  guard: Guard;
  onPendingChange: (state: DocumentPending) => void;
  onBack: () => void;
}) {
  const [document, setDocument] = useState(initial);
  const [title, setTitle] = useState(initial.title),
    [description, setDescription] = useState(initial.description),
    [content, setContent] = useState(initial.content);
  const [editing, setEditing] = useState(false),
    [saving, setSaving] = useState(false),
    [uploading, setUploading] = useState(0);
  const [error, setError] = useState(""),
    [conflict, setConflict] = useState(false);
  const pending =
    title !== document.title ||
    description !== document.description ||
    content !== document.content ||
    uploading > 0;
  const busy = saving || uploading > 0;
  const canEdit = document.permissions.canEdit;
  useEffect(() => {
    onPendingChange({ pending, busy });
  }, [pending, busy, onPendingChange]);
  useEffect(
    () => () => onPendingChange({ pending: false, busy: false }),
    [onPendingChange],
  );
  function reset(value: DocumentDetail) {
    setDocument(value);
    setTitle(value.title);
    setDescription(value.description);
    setContent(value.content);
    setEditing(false);
    setError("");
    setConflict(false);
  }
  async function save() {
    setSaving(true);
    setError("");
    try {
      reset(
        await api<DocumentDetail>(`/api/documents/${document.id}`, {
          method: "PUT",
          body: JSON.stringify({
            title,
            description,
            content,
            revision: document.revision,
          }),
        }),
      );
      toast.success("Documento guardado.");
    } catch (error) {
      setError((error as Error).message);
      setConflict((error as { status?: number }).status === 409);
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className={styles.editor} aria-label="Editor de documento">
      <header className={styles.editorHeader}>
        <Button variant="ghost" disabled={busy} onClick={() => guard(onBack)}>
          <ArrowLeft size={16} />
          Documentos
        </Button>
        <div className={styles.actions}>
          {pending && <span>Cambios sin guardar</span>}
          {canEdit && (
            <>
              <Button
                variant="outline"
                disabled={!pending || busy}
                onClick={() => guard(() => reset(document))}
              >
                Descartar
              </Button>
              <Button
                disabled={!pending || busy || !title.trim() || conflict}
                onClick={() => void save()}
              >
                {saving ? (
                  <Loader2 className="animate-spin" size={16} />
                ) : (
                  <Check size={16} />
                )}
                Guardar
              </Button>
            </>
          )}
        </div>
      </header>
      {error && (
        <div className={styles.error} role="alert">
          {error}
          {conflict && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                guard(() => {
                  setSaving(true);
                  api<DocumentDetail>(`/api/documents/${document.id}`)
                    .then(reset)
                    .catch((error) => setError(error.message))
                    .finally(() => setSaving(false));
                })
              }
            >
              Recargar versión guardada
            </Button>
          )}
        </div>
      )}
      <div className={styles.metadata}>
        <h2 className={styles.documentTitle}>
          <DocumentInlineText
            value={title}
            change={setTitle}
            label="Título del documento"
            placeholder="Título del documento"
            maxLength={160}
            readOnly={!canEdit || busy}
            required
          />
        </h2>
        <DocumentInlineText
          value={description}
          change={setDescription}
          label="Descripción breve del documento"
          placeholder={
            canEdit ? "Añade una descripción breve…" : "Sin descripción"
          }
          maxLength={1000}
          readOnly={!canEdit || busy}
        />
      </div>
      <div className={styles.content}>
        <DescriptionEditor
          value={content}
          onChange={setContent}
          editing={editing}
          setEditing={setEditing}
          disabled={!canEdit || saving}
          onUploadingChange={setUploading}
          label="Contenido del documento"
          diagramScope={document.scope}
          uploadImage={async (file) =>
            (
              await uploadFile(
                file,
                document.scope.projectId,
                document.scope,
                "image",
              )
            ).url
          }
        />
      </div>
    </section>
  );
}

function DocumentInlineText({
  value,
  change,
  label,
  placeholder,
  maxLength,
  readOnly,
  required = false,
}: {
  value: string;
  change: (value: string) => void;
  label: string;
  placeholder: string;
  maxLength: number;
  readOnly: boolean;
  required?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const initial = useRef(value),
    beforeEdit = useRef(value);
  useEffect(() => {
    if (ref.current && ref.current.textContent !== value)
      ref.current.textContent = value;
  }, [value]);
  return (
    <div
      ref={ref}
      className={styles.inlineText}
      role="textbox"
      aria-label={label}
      aria-multiline="false"
      aria-readonly={readOnly}
      aria-required={required}
      contentEditable={readOnly ? false : "plaintext-only"}
      suppressContentEditableWarning
      tabIndex={0}
      data-placeholder={placeholder}
      title={
        readOnly
          ? label
          : "Clic para editar · Enter para terminar · Escape para cancelar"
      }
      onFocus={() => {
        beforeEdit.current = value;
      }}
      onInput={(event) => {
        const text = event.currentTarget.textContent ?? "";
        if (text.length > maxLength) {
          event.currentTarget.textContent = text.slice(0, maxLength);
          const selection = window.getSelection();
          selection?.selectAllChildren(event.currentTarget);
          selection?.collapseToEnd();
        }
        change(text.slice(0, maxLength));
      }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
        if (event.key === "Escape") {
          event.preventDefault();
          change(beforeEdit.current);
          event.currentTarget.textContent = beforeEdit.current;
          event.currentTarget.blur();
        }
      }}
      onBlur={(event) => {
        if (!readOnly && required)
          change(event.currentTarget.textContent?.trim() || beforeEdit.current);
      }}
    >
      {initial.current}
    </div>
  );
}
