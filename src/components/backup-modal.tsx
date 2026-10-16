"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Tabs } from "radix-ui";
import {
  AlertTriangle,
  CheckCircle2,
  DatabaseBackup,
  Download,
  Loader2,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  MAX_BACKUP_BYTES,
  RESTORE_CONFIRMATION,
  type BackupFile,
} from "@/lib/backups";

function fileSize(bytes: number) {
  return bytes < 1024 * 1024
    ? `${(bytes / 1024).toLocaleString("es", { maximumFractionDigits: 1 })} KB`
    : `${(bytes / 1024 / 1024).toLocaleString("es", { maximumFractionDigits: 1 })} MB`;
}
function backupDate(backup: BackupFile) {
  return new Date(backup.createdAt).toLocaleString("es-CO", {
    dateStyle: "medium",
    timeStyle: "medium",
  });
}
async function checkResponse(response: Response) {
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(
      data.error || "No se pudo completar la operación. Vuelve a intentarlo.",
    );
  }
  return response;
}

export function BackupModal({ close }: { close: () => void }) {
  const [backups, setBackups] = useState<BackupFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState("");
  const operation = useRef(false);
  const [tab, setTab] = useState("backups");
  const [source, setSource] = useState("server");
  const [backupId, setBackupId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [deleting, setDeleting] = useState<BackupFile | null>(null);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [backupBeforeRestore, setBackupBeforeRestore] = useState(true);
  const [restored, setRestored] = useState<{
    safetyBackup?: BackupFile;
  } | null>(null);
  const selected = backups.find((backup) => backup.id === backupId);
  const busy = !!pending;
  const load = useCallback(async () => {
    setLoading(true);
    setListError("");
    try {
      const response = await checkResponse(
        await fetch("/api/backups", { cache: "no-store" }),
      );
      setBackups((await response.json()).backups);
    } catch (error) {
      setListError(
        error instanceof Error
          ? error.message
          : "No se pudieron cargar los respaldos.",
      );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  function dismiss() {
    if (operation.current) return;
    if (restored) window.location.assign("/");
    else close();
  }
  async function run(name: string, action: () => Promise<void>) {
    if (operation.current) return;
    operation.current = true;
    setPending(name);
    setError("");
    try {
      await action();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "No se pudo completar la operación.";
      setError(message);
      toast.error(message);
    } finally {
      operation.current = false;
      setPending("");
    }
  }
  function create() {
    void run("create", async () => {
      const response = await checkResponse(
        await fetch("/api/backups", { method: "POST" }),
      );
      const { backup }: { backup: BackupFile } = await response.json();
      setBackups((current) => [backup, ...current]);
      toast.success("Respaldo guardado en el servidor.");
    });
  }
  function download(backup: BackupFile) {
    void run(`download:${backup.id}`, async () => {
      const response = await checkResponse(
        await fetch(`/api/backups/${encodeURIComponent(backup.id)}`),
      );
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = backup.id;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10000);
      toast.success("Respaldo descargado.");
    });
  }
  function remove() {
    if (!deleting) return;
    const id = deleting.id;
    void run("delete", async () => {
      await checkResponse(
        await fetch(`/api/backups/${encodeURIComponent(id)}`, {
          method: "DELETE",
        }),
      );
      setBackups((current) => current.filter((backup) => backup.id !== id));
      if (backupId === id) setBackupId("");
      setDeleting(null);
      toast.success("Respaldo eliminado del servidor.");
    });
  }
  function restore(event: FormEvent) {
    event.preventDefault();
    if (confirmation !== RESTORE_CONFIRMATION) return;
    void run("restore", async () => {
      const form = new FormData();
      form.set("confirmation", confirmation);
      form.set("backupBeforeRestore", String(backupBeforeRestore));
      if (source === "server") form.set("backupId", backupId);
      else if (file) form.set("file", file);
      const response = await checkResponse(
        await fetch("/api/backups/restore", { method: "POST", body: form }),
      );
      setRestored(await response.json());
      setConfirmRestore(false);
    });
  }
  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) dismiss();
        }}
      >
        <DialogContent
          className="backup-dialog"
          showCloseButton={!busy}
          onEscapeKeyDown={(event) => {
            if (operation.current) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (operation.current) event.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle className="backup-title">
              <DatabaseBackup size={22} /> Respaldo
            </DialogTitle>
            <DialogDescription>
              Guarda y recupera una copia completa de todos tus proyectos y
              tareas.
            </DialogDescription>
          </DialogHeader>
          {restored ? (
            <div className="backup-success" role="status">
              <CheckCircle2 size={36} />
              <h3>Restauración completada</h3>
              <p>
                La base de datos se restauró correctamente. Vuelve al espacio
                para cargar los datos recuperados.
              </p>
              {restored.safetyBackup && (
                <p>
                  Se guardó un respaldo previo en el servidor. Lo encontrarás en
                  la pestaña Copias de respaldo.
                </p>
              )}
              <Button onClick={dismiss}>Volver al espacio</Button>
            </div>
          ) : (
            <Tabs.Root
              value={tab}
              onValueChange={(value) => {
                if (!busy) {
                  setTab(value);
                  setError("");
                }
              }}
            >
              <Tabs.List
                className="backup-tabs"
                aria-label="Gestión de respaldos"
              >
                <Tabs.Trigger value="backups" disabled={busy}>
                  <DatabaseBackup size={16} /> Copias de respaldo
                </Tabs.Trigger>
                <Tabs.Trigger value="restore" disabled={busy}>
                  <RotateCcw size={16} /> Restaurar
                </Tabs.Trigger>
              </Tabs.List>
              {error && !confirmRestore && !deleting && (
                <p className="backup-error" role="alert">
                  {error}
                </p>
              )}
              <Tabs.Content value="backups" className="backup-panel">
                <div className="backup-toolbar">
                  <div>
                    <h3>Copias en el servidor</h3>
                    <p>
                      Genera una copia para conservarla, descargarla o
                      restaurarla después.
                    </p>
                  </div>
                  <Button
                    disabled={busy || loading || !!listError}
                    onClick={create}
                  >
                    {pending === "create" ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <Plus />
                    )}{" "}
                    Generar respaldo
                  </Button>
                </div>
                {loading ? (
                  <p className="backup-empty" role="status">
                    <Loader2 className="animate-spin" size={18} /> Cargando
                    respaldos…
                  </p>
                ) : listError ? (
                  <div className="backup-error" role="alert">
                    <p>{listError}</p>
                    <Button
                      variant="outline"
                      onClick={() => void load()}
                      disabled={busy}
                    >
                      Volver a intentar
                    </Button>
                  </div>
                ) : backups.length === 0 ? (
                  <div className="backup-empty">
                    <DatabaseBackup size={28} />
                    <h3>Aún no hay copias de respaldo</h3>
                    <p>
                      Genera la primera copia para guardarla en este servidor.
                    </p>
                  </div>
                ) : (
                  <ul
                    className="backup-list"
                    aria-label="Copias de respaldo del servidor"
                  >
                    {backups.map((backup) => (
                      <li key={backup.id}>
                        <DatabaseBackup
                          size={20}
                          className="backup-file-icon"
                        />
                        <div className="backup-file-info">
                          <strong>{backupDate(backup)}</strong>
                          <span>
                            {backup.kind === "before-restore"
                              ? "Previo a restauración"
                              : "Respaldo manual"}{" "}
                            · {fileSize(backup.size)}
                          </span>
                          <span className="backup-filename" title={backup.id}>
                            {backup.id}
                          </span>
                        </div>
                        <div className="backup-file-actions">
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Descargar respaldo"
                            aria-label={`Descargar respaldo del ${backupDate(backup)}`}
                            disabled={busy}
                            onClick={() => download(backup)}
                          >
                            {pending === `download:${backup.id}` ? (
                              <Loader2 className="animate-spin" />
                            ) : (
                              <Download />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Restaurar respaldo"
                            aria-label={`Restaurar respaldo del ${backupDate(backup)}`}
                            disabled={busy}
                            onClick={() => {
                              setBackupId(backup.id);
                              setSource("server");
                              setTab("restore");
                              setError("");
                            }}
                          >
                            <RotateCcw />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="danger"
                            title="Eliminar respaldo"
                            aria-label={`Eliminar respaldo del ${backupDate(backup)}`}
                            disabled={busy}
                            onClick={() => {
                              setError("");
                              setDeleting(backup);
                            }}
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Tabs.Content>
              <Tabs.Content value="restore" className="backup-panel">
                <div className="backup-warning">
                  <AlertTriangle size={19} />
                  <p>
                    La restauración reemplazará todos los datos actuales del
                    espacio por los de la copia seleccionada.
                  </p>
                </div>
                <fieldset className="backup-source" disabled={busy}>
                  <legend>Origen del respaldo</legend>
                  <label>
                    <input
                      type="radio"
                      name="backup-source"
                      value="server"
                      checked={source === "server"}
                      onChange={() => {
                        setSource("server");
                        setError("");
                      }}
                    />
                    <DatabaseBackup size={18} /> Copia del servidor
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="backup-source"
                      value="upload"
                      checked={source === "upload"}
                      onChange={() => {
                        setSource("upload");
                        setError("");
                      }}
                    />
                    <Upload size={18} /> Adjuntar archivo
                  </label>
                </fieldset>
                {source === "server" ? (
                  <div className="field">
                    <label htmlFor="restore-backup">Copia del servidor</label>
                    <select
                      id="restore-backup"
                      value={backupId}
                      onChange={(event) => setBackupId(event.target.value)}
                      disabled={busy || loading || !!listError}
                    >
                      <option value="">Selecciona una copia de respaldo</option>
                      {backups.map((backup) => (
                        <option key={backup.id} value={backup.id}>
                          {backupDate(backup)} ·{" "}
                          {backup.kind === "before-restore"
                            ? "Previo a restauración"
                            : "Manual"}{" "}
                          · {fileSize(backup.size)} · {backup.id.slice(-13, -7)}
                        </option>
                      ))}
                    </select>
                    {loading ? (
                      <p className="backup-hint" role="status">
                        Cargando respaldos…
                      </p>
                    ) : listError ? (
                      <div className="backup-error" role="alert">
                        <p>{listError}</p>
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={() => void load()}
                        >
                          Volver a intentar
                        </Button>
                      </div>
                    ) : (
                      backups.length === 0 && (
                        <p className="backup-hint">
                          No hay copias en el servidor. Genera una en la otra
                          pestaña o adjunta un archivo.
                        </p>
                      )
                    )}
                  </div>
                ) : (
                  <div className="field">
                    <label htmlFor="restore-file">
                      Archivo de respaldo SQLite
                    </label>
                    <Input
                      id="restore-file"
                      type="file"
                      accept=".sqlite,.sqlite3,.db,application/vnd.sqlite3,application/x-sqlite3"
                      disabled={busy}
                      aria-describedby="restore-file-help"
                      onChange={(event) => {
                        const selectedFile = event.target.files?.[0] ?? null;
                        setError("");
                        if (
                          selectedFile &&
                          (!selectedFile.size ||
                            selectedFile.size > MAX_BACKUP_BYTES)
                        ) {
                          setFile(null);
                          setError(
                            "Adjunta un respaldo SQLite de hasta 100 MB.",
                          );
                          event.target.value = "";
                        } else setFile(selectedFile);
                      }}
                    />
                    <p id="restore-file-help" className="backup-hint">
                      Adjunta una copia exportada desde Brote (.sqlite, .sqlite3
                      o .db), de hasta 100 MB.
                    </p>
                    {file && (
                      <p className="backup-selected-file">
                        {file.name} · {fileSize(file.size)}
                      </p>
                    )}
                  </div>
                )}
                <div className="backup-restore-actions">
                  <Button
                    disabled={
                      busy ||
                      (source === "server"
                        ? !selected || loading || !!listError
                        : !file)
                    }
                    onClick={() => {
                      setConfirmation("");
                      setBackupBeforeRestore(true);
                      setError("");
                      setConfirmRestore(true);
                    }}
                  >
                    <RotateCcw /> Continuar con la restauración
                  </Button>
                </div>
              </Tabs.Content>
            </Tabs.Root>
          )}
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={confirmRestore}
        onOpenChange={(open) => {
          if (!operation.current) setConfirmRestore(open);
        }}
      >
        <AlertDialogContent className="backup-confirm-dialog">
          <form onSubmit={restore} className="form-stack">
            <AlertDialogHeader>
              <AlertDialogTitle>Confirmar restauración</AlertDialogTitle>
              <AlertDialogDescription>
                Se reemplazarán todos los proyectos, tareas y demás datos
                actuales. Los cambios posteriores a esta copia se perderán.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <p className="backup-confirm-source">
              {source === "server" && selected
                ? `Copia del servidor: ${backupDate(selected)}`
                : file?.name}
              <span>
                {source === "server" ? selected?.id : "Archivo adjunto"}
              </span>
            </p>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={backupBeforeRestore}
                disabled={busy}
                onChange={(event) =>
                  setBackupBeforeRestore(event.target.checked)
                }
              />{" "}
              Crear un respaldo de los datos actuales antes de restaurar
            </label>
            <div className="field">
              <label htmlFor="restore-confirmation">
                Escribe <strong>{RESTORE_CONFIRMATION}</strong> para confirmar
              </label>
              <Input
                id="restore-confirmation"
                autoComplete="off"
                spellCheck={false}
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                disabled={busy}
              />
            </div>
            {error && (
              <p className="backup-error" role="alert">
                {error}
              </p>
            )}
            <AlertDialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setConfirmRestore(false)}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                variant="destructive"
                disabled={busy || confirmation !== RESTORE_CONFIRMATION}
              >
                {pending === "restore" ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <RotateCcw />
                )}
                {pending === "restore"
                  ? "Restaurando…"
                  : "Restaurar base de datos"}
              </Button>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open && !operation.current) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar respaldo</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará la copia del {deleting && backupDate(deleting)} del
              servidor. Esta acción no modifica los datos actuales del espacio.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && (
            <p className="backup-error" role="alert">
              {error}
            </p>
          )}
          <AlertDialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setDeleting(null)}
            >
              Cancelar
            </Button>
            <Button variant="destructive" disabled={busy} onClick={remove}>
              {pending === "delete" && <Loader2 className="animate-spin" />}
              Eliminar respaldo
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
