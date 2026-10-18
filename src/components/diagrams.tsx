"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Check,
  Copy,
  ExternalLink,
  GitBranch,
  Globe2,
  Loader2,
  LockKeyhole,
  Maximize2,
  Minimize2,
  Plus,
  RefreshCw,
  Share2,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { useUnsavedChanges } from "./unsaved-changes";
import type { EntityPermissions, EntityRef } from "@/lib/types";
import {
  diagramBackPath,
  diagramBytes,
  emptyDiagramScene,
  sceneFingerprint,
  MAX_DIAGRAM_BYTES,
  type DiagramDocument,
  type DiagramInput,
  type DiagramScene,
  type DiagramSummary,
  type PublicDiagram,
} from "@/lib/diagrams";
import styles from "./diagrams.module.css";

const Canvas = dynamic(() => import("./diagram-canvas"), {
  ssr: false,
  loading: () => (
    <div className={styles.loading}>
      <Loader2 className="animate-spin" size={22} />
      <span>Preparando el lienzo…</span>
    </div>
  ),
});
export type DiagramPending = { pending: boolean; busy: boolean };
type Guard = (action: () => void) => void;
const clean = (document: DiagramInput) => ({
  title: document.title.trim(),
  description: document.description.trim(),
  scene: document.scene,
});
const sceneStamp = (scene: DiagramScene) =>
  JSON.stringify([
    scene.appState.viewBackgroundColor,
    scene.elements.map((element) => [
      element.id,
      element.version,
      element.versionNonce,
      element.index,
    ]),
    Object.keys(scene.files).sort(),
  ]);
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
function selectDiagram(id: string | null) {
  const url = new URL(window.location.href);
  url.searchParams.set("tab", "diagrams");
  if (id) url.searchParams.set("diagram", id);
  else url.searchParams.delete("diagram");
  window.history.replaceState(null, "", `${url.pathname}${url.search}`);
}
function savedLabel(date: string) {
  return new Intl.DateTimeFormat("es-CO", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(date));
}

export function EntityDiagrams({
  scope,
  guard,
  onPendingChange,
}: {
  scope: EntityRef;
  guard: Guard;
  onPendingChange: (state: DiagramPending) => void;
}) {
  const query = useSearchParams();
  const selected = query.get("diagram");
  const [listing, setListing] = useState<{
    diagrams: DiagramSummary[];
    permissions: EntityPermissions;
  }>();
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [remove, setRemove] = useState<DiagramSummary | null>(null);
  const endpoint = `/api/entities/${scope.kind}/${encodeURIComponent(scope.id)}/diagrams`;
  const load = useCallback(() => {
    setError("");
    return api<NonNullable<typeof listing>>(endpoint)
      .then(setListing)
      .catch((e) => setError(e.message));
  }, [endpoint]);
  useEffect(() => {
    void load();
  }, [load]);
  async function create(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const document = await api<DiagramDocument>(endpoint, {
        method: "POST",
        body: JSON.stringify({
          title,
          description,
          scene: emptyDiagramScene(),
        }),
      });
      setCreating(false);
      setTitle("");
      setDescription("");
      selectDiagram(document.id);
      void load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  if (selected)
    return (
      <DiagramLoader
        key={selected}
        id={selected}
        expectedScope={scope}
        guard={guard}
        onPendingChange={onPendingChange}
        onBack={() => {
          selectDiagram(null);
          void load();
        }}
      />
    );
  return (
    <div className={styles.collection}>
      <header className={styles.collectionHeader}>
        <div>
          <div className={styles.eyebrow}>IDEAS QUE TOMAN FORMA</div>
          <h2>
            Diagramas <span>{listing?.diagrams.length ?? 0}</span>
          </h2>
          <p>Conecta ideas, explica flujos y da contexto al trabajo.</p>
        </div>
        {listing?.permissions.canEdit && (
          <Button onClick={() => guard(() => setCreating(true))}>
            <Plus size={16} />
            Nuevo diagrama
          </Button>
        )}
      </header>
      {!listing && !error && (
        <div className={styles.loading}>
          <Loader2 className="animate-spin" />
          Cargando diagramas…
        </div>
      )}
      {error && (
        <div className={styles.empty}>
          <p role="alert">{error}</p>
          <Button variant="outline" onClick={() => void load()}>
            <RefreshCw />
            Reintentar
          </Button>
        </div>
      )}
      {listing && !listing.diagrams.length && (
        <div className={styles.empty}>
          <div className={styles.emptyArt} aria-hidden="true">
            <span />
            <GitBranch size={42} strokeWidth={1.3} />
            <span />
          </div>
          <h3>Una idea se entiende mejor cuando la dibujas.</h3>
          <p>
            Reúne aquí la arquitectura, los procesos y los bocetos de este
            trabajo.
          </p>
          {listing.permissions.canEdit && (
            <Button
              variant="outline"
              onClick={() => guard(() => setCreating(true))}
            >
              <Plus size={16} />
              Crear el primer diagrama
            </Button>
          )}
        </div>
      )}
      <div className={styles.grid}>
        {listing?.diagrams.map((diagram) => (
          <article className={styles.card} key={diagram.id}>
            <button
              className={styles.cardOpen}
              onClick={() => guard(() => selectDiagram(diagram.id))}
            >
              <div className={styles.cardTop}>
                <span className={styles.cardIcon}>
                  <GitBranch size={23} strokeWidth={1.5} />
                </span>
                <span
                  className={
                    diagram.isPublic ? styles.publicBadge : styles.badge
                  }
                >
                  {diagram.isPublic ? (
                    <Globe2 size={12} />
                  ) : (
                    <LockKeyhole size={12} />
                  )}
                  {diagram.isPublic ? "Público" : "Privado"}
                </span>
              </div>
              <h3>{diagram.title}</h3>
              <p>{diagram.description || "Sin descripción"}</p>
              <footer>
                <span>Actualizado el {savedLabel(diagram.updatedAt)}</span>
                <span className={styles.openHint}>
                  Abrir <ExternalLink size={12} />
                </span>
              </footer>
            </button>
            {listing.permissions.canEdit && (
              <button
                className={styles.cardDelete}
                aria-label={`Eliminar ${diagram.title}`}
                onClick={() => guard(() => setRemove(diagram))}
              >
                <Trash2 size={15} />
              </button>
            )}
          </article>
        ))}
      </div>
      <Dialog
        open={creating}
        onOpenChange={(open) => {
          if (!saving) setCreating(open);
        }}
      >
        <DialogContent>
          <DialogTitle>Nuevo diagrama</DialogTitle>
          <DialogDescription>
            Un espacio para explicar visualmente tu idea.
          </DialogDescription>
          <form onSubmit={create} className={styles.form}>
            <label>
              Título
              <Input
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={160}
                required
                placeholder="Ej. Flujo de autenticación"
                disabled={saving}
              />
            </label>
            <label>
              Descripción <span>opcional</span>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={1000}
                placeholder="¿Qué explica este diagrama?"
                disabled={saving}
              />
            </label>
            <div className={styles.formActions}>
              <Button
                type="button"
                variant="ghost"
                disabled={saving}
                onClick={() => setCreating(false)}
              >
                Cancelar
              </Button>
              <Button disabled={saving || !title.trim()}>
                {saving ? <Loader2 className="animate-spin" /> : <Plus />}Crear
                diagrama
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!remove}
        onOpenChange={(open) => {
          if (!open && !saving) setRemove(null);
        }}
      >
        <DialogContent>
          <DialogTitle>Eliminar diagrama</DialogTitle>
          <DialogDescription>
            Se eliminará «{remove?.title}» y su enlace público dejará de
            funcionar. Esta acción no se puede deshacer.
          </DialogDescription>
          <div className={styles.formActions}>
            <Button
              variant="outline"
              disabled={saving}
              onClick={() => setRemove(null)}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={saving}
              onClick={async () => {
                if (!remove) return;
                setSaving(true);
                try {
                  await api(`/api/diagrams/${remove.id}`, { method: "DELETE" });
                  setRemove(null);
                  await load();
                  toast.success("Diagrama eliminado.");
                } catch (e) {
                  toast.error((e as Error).message);
                } finally {
                  setSaving(false);
                }
              }}
            >
              Eliminar diagrama
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DiagramLoader({
  id,
  expectedScope,
  guard,
  onPendingChange,
  onBack,
  standalone = false,
}: {
  id: string;
  expectedScope?: EntityRef;
  guard: Guard;
  onPendingChange: (state: DiagramPending) => void;
  onBack: () => void;
  standalone?: boolean;
}) {
  const [document, setDocument] = useState<DiagramDocument>();
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api<DiagramDocument>(`/api/diagrams/${encodeURIComponent(id)}`)
      .then((value) => {
        if (
          expectedScope &&
          (value.scope.kind !== expectedScope.kind ||
            value.scope.id !== expectedScope.id ||
            value.scope.projectId !== expectedScope.projectId)
        )
          throw new Error("Este diagrama no pertenece al elemento.");
        if (active) setDocument(value);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [id, expectedScope?.kind, expectedScope?.id, expectedScope?.projectId]);
  if (error)
    return (
      <div className={styles.empty}>
        <GitBranch size={30} />
        <h3>Diagrama no disponible</h3>
        <p role="alert">{error}</p>
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft />
          Volver a diagramas
        </Button>
      </div>
    );
  if (!document)
    return (
      <div className={styles.loading}>
        <Loader2 className="animate-spin" />
        Abriendo diagrama…
      </div>
    );
  return (
    <DiagramEditor
      initial={document}
      guard={guard}
      onPendingChange={onPendingChange}
      onBack={onBack}
      standalone={standalone}
    />
  );
}

export function DiagramEditor({
  initial,
  guard,
  onPendingChange,
  onBack,
  standalone = false,
}: {
  initial: DiagramDocument;
  guard: Guard;
  onPendingChange: (state: DiagramPending) => void;
  onBack: () => void;
  standalone?: boolean;
}) {
  const [document, setDocument] = useState(initial);
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
  const scene = useRef(initial.scene);
  const baseline = useRef(sceneFingerprint(initial.scene));
  const baselineStamp = useRef(sceneStamp(initial.scene));
  const [canvasDirty, setCanvasDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [full, setFull] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [canvasKey, setCanvasKey] = useState(0);
  const pending =
    canvasDirty ||
    title !== document.title ||
    description !== document.description;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canvasReady = useCallback((value: DiagramScene) => {
    if (timer.current) clearTimeout(timer.current);
    scene.current = value;
    baseline.current = sceneFingerprint(value);
    baselineStamp.current = sceneStamp(value);
    setCanvasDirty(false);
  }, []);
  const canvasChanged = useCallback((value: DiagramScene) => {
    scene.current = value;
    if (sceneStamp(value) !== baselineStamp.current) setCanvasDirty(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(
      () => setCanvasDirty(sceneFingerprint(value) !== baseline.current),
      100,
    );
  }, []);
  useEffect(() => {
    onPendingChange({ pending, busy });
  }, [pending, busy, onPendingChange]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      onPendingChange({ pending: false, busy: false });
    },
    [onPendingChange],
  );
  useEffect(() => {
    if (!full) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) setFull(false);
    };
    documentBodyLock(true);
    window.addEventListener("keydown", escape);
    return () => {
      documentBodyLock(false);
      window.removeEventListener("keydown", escape);
    };
  }, [full]);
  async function save() {
    const value = clean({ title, description, scene: scene.current });
    if (diagramBytes(value) > MAX_DIAGRAM_BYTES) {
      setError(
        "El diagrama supera 3 MB. Reduce las imágenes para poder guardarlo.",
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      const saved = await api<DiagramDocument>(`/api/diagrams/${document.id}`, {
        method: "PUT",
        body: JSON.stringify({ ...value, revision: document.revision }),
      });
      setDocument(saved);
      setTitle(saved.title);
      setDescription(saved.description);
      baseline.current = sceneFingerprint(saved.scene);
      baselineStamp.current = sceneStamp(saved.scene);
      scene.current = saved.scene;
      setCanvasDirty(false);
      setConflict(false);
      toast.success("Diagrama guardado.");
    } catch (e) {
      setError((e as Error).message);
      setConflict((e as { status?: number }).status === 409);
    } finally {
      setBusy(false);
    }
  }
  async function share(enabled: boolean) {
    setBusy(true);
    try {
      const saved = await api<DiagramDocument>(
        `/api/diagrams/${document.id}/share`,
        { method: enabled ? "POST" : "DELETE" },
      );
      // Sharing must not advance the revision of an older local draft.
      setDocument((current) => ({
        ...current,
        isPublic: saved.isPublic,
        publicPath: saved.publicPath,
        permissions: saved.permissions,
      }));
      toast.success(
        enabled ? "Enlace público activado." : "Enlace público desactivado.",
      );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className={`${styles.editor} ${full ? styles.fullscreen : ""} ${standalone ? styles.standaloneEditor : ""}`}
      aria-label="Editor de diagrama"
    >
      <header className={styles.editorHeader}>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Volver a diagramas"
          disabled={busy}
          onClick={() => guard(onBack)}
        >
          <ArrowLeft size={17} />
        </Button>
        <div className={styles.editorMeta}>
          <input
            aria-label="Título del diagrama"
            placeholder="Título del diagrama"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={160}
            disabled={busy || !document.permissions.canEdit}
          />
          <textarea
            aria-label="Descripción del diagrama"
            placeholder={
              document.permissions.canEdit
                ? "Añade contexto a este diagrama…"
                : "Sin descripción"
            }
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={1}
            maxLength={1000}
            disabled={busy || !document.permissions.canEdit}
          />
        </div>
        <div className={styles.editorActions}>
          {document.permissions.canManageAccess && (
            <Button
              variant="outline"
              size="sm"
              aria-label="Compartir"
              disabled={busy || pending}
              title={
                pending
                  ? "Guarda los cambios antes de compartir"
                  : "Compartir diagrama"
              }
              onClick={() => setSharing(true)}
            >
              <Share2 size={15} />
              <span className={styles.actionLabel}>Compartir</span>
            </Button>
          )}
          {!standalone && (
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={busy || pending}
              aria-label="Abrir en otra pestaña"
              title={
                pending
                  ? "Guarda antes de abrir otra pestaña"
                  : "Abrir en otra pestaña"
              }
              onClick={() =>
                window.open(
                  `/projects/${document.scope.projectId}/diagrams/${document.id}`,
                  "_blank",
                  "noopener,noreferrer",
                )
              }
            >
              <ExternalLink size={17} />
            </Button>
          )}
          {!standalone && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={
                full ? "Salir de pantalla completa" : "Pantalla completa"
              }
              onClick={() => setFull(!full)}
            >
              {full ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
            </Button>
          )}
          {document.permissions.canEdit && (
            <Button
              size="sm"
              title={
                busy
                  ? "Guardando diagrama…"
                  : pending
                    ? "Guardar cambios del diagrama"
                    : "Diagrama guardado"
              }
              aria-description={
                busy
                  ? "Guardando"
                  : pending
                    ? "Cambios pendientes de guardar"
                    : "Sin cambios pendientes"
              }
              aria-busy={busy}
              disabled={busy || !pending || !title.trim()}
              onClick={() => void save()}
            >
              {busy ? (
                <Loader2 className="animate-spin" size={15} />
              ) : (
                <Check size={15} />
              )}
              Guardar
              {pending && !busy && (
                <span className={styles.pendingDot} aria-hidden="true" />
              )}
            </Button>
          )}
        </div>
      </header>
      {error && (
        <div className={styles.error} role="alert">
          <span>{error}</span>
          {conflict && (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                guard(async () => {
                  try {
                    const saved = await api<DiagramDocument>(
                      `/api/diagrams/${document.id}`,
                    );
                    setDocument(saved);
                    setTitle(saved.title);
                    setDescription(saved.description);
                    scene.current = saved.scene;
                    baseline.current = sceneFingerprint(saved.scene);
                    baselineStamp.current = sceneStamp(saved.scene);
                    setCanvasDirty(false);
                    setCanvasKey((k) => k + 1);
                    setError("");
                    setConflict(false);
                  } catch (e) {
                    setError((e as Error).message);
                  }
                })
              }
            >
              <RefreshCw />
              Recargar versión guardada
            </Button>
          )}
        </div>
      )}
      <div className={styles.canvas} inert={busy} aria-busy={busy}>
        <Canvas
          key={canvasKey}
          scene={document.scene}
          onChange={canvasChanged}
          onReady={canvasReady}
          readOnly={!document.permissions.canEdit}
        />
      </div>
      <footer className={styles.editorFooter}>
        <span>
          {document.isPublic ? (
            <>
              <Globe2 size={12} />
              Enlace público activo
            </>
          ) : (
            <>
              <LockKeyhole size={12} />
              Solo personas con acceso a este trabajo
            </>
          )}
        </span>
        <span>Hasta 3 MB · Imágenes incluidas</span>
      </footer>
      <Dialog
        open={sharing}
        onOpenChange={(value) => {
          if (!busy) setSharing(value);
        }}
      >
        <DialogContent>
          <DialogTitle>Compartir diagrama</DialogTitle>
          <DialogDescription>
            Quien tenga el enlace podrá consultar el diagrama sin iniciar
            sesión. Verá la última versión que guardes, sin acceder al resto de
            Taskode.
          </DialogDescription>
          <div className={styles.shareStatus}>
            <span
              className={document.isPublic ? styles.publicBadge : styles.badge}
            >
              {document.isPublic ? (
                <Globe2 size={14} />
              ) : (
                <LockKeyhole size={14} />
              )}
              {document.isPublic ? "Enlace público activo" : "Diagrama privado"}
            </span>
          </div>
          {document.publicPath && (
            <label className={styles.shareLink}>
              Enlace de solo lectura
              <div>
                <Input
                  readOnly
                  aria-label="Enlace público"
                  value={
                    typeof window !== "undefined"
                      ? `${window.location.origin}${document.publicPath}`
                      : document.publicPath
                  }
                />
                <Button
                  variant="outline"
                  size="icon"
                  disabled={busy}
                  aria-label="Copiar enlace"
                  onClick={() =>
                    navigator.clipboard
                      .writeText(
                        `${window.location.origin}${document.publicPath}`,
                      )
                      .then(() => toast.success("Enlace copiado."))
                      .catch(() => toast.error("Selecciona y copia el enlace."))
                  }
                >
                  <Copy size={16} />
                </Button>
              </div>
            </label>
          )}
          <div className={styles.formActions}>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => setSharing(false)}
            >
              Cerrar
            </Button>
            <Button
              variant={document.isPublic ? "outline" : "default"}
              disabled={busy}
              onClick={() => void share(!document.isPublic)}
            >
              {busy ? (
                <Loader2 className="animate-spin" />
              ) : document.isPublic ? (
                <LockKeyhole />
              ) : (
                <Globe2 />
              )}
              {document.isPublic
                ? "Desactivar enlace"
                : "Activar enlace público"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
function documentBodyLock(lock: boolean) {
  window.document.body.style.overflow = lock ? "hidden" : "";
}

export function StandaloneDiagram({ initial }: { initial: DiagramDocument }) {
  const [state, setState] = useState<DiagramPending>({
    pending: false,
    busy: false,
  });
  const { requestNavigation, leaveDialog } = useUnsavedChanges(
    state.pending,
    state.busy,
    "diagrama",
  );
  return (
    <main className={styles.standalone}>
      <DiagramEditor
        initial={initial}
        guard={requestNavigation}
        onPendingChange={setState}
        onBack={() =>
          window.location.assign(diagramBackPath(initial.scope, initial.id))
        }
        standalone
      />
      {leaveDialog}
    </main>
  );
}
export function PublicDiagramView({ document }: { document: PublicDiagram }) {
  return (
    <main className={styles.publicPage}>
      <header className={styles.publicHeader}>
        <span className={styles.editorMark}>
          <GitBranch size={20} />
        </span>
        <div>
          <h1>{document.title}</h1>
          {document.description && <p>{document.description}</p>}
        </div>
        <span className={styles.badge}>
          <Globe2 size={12} />
          Solo lectura
        </span>
      </header>
      <div className={styles.publicCanvas}>
        <Canvas scene={document.scene} readOnly publicView />
      </div>
    </main>
  );
}
