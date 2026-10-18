"use client";
import { useEffect, useId, useRef, useState } from "react";
import {
  Download,
  File as FileIcon,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Loader2,
  Paperclip,
  Plus,
  Trash2,
  UploadCloud,
  ZoomIn,
} from "lucide-react";
import { toast } from "sonner";
import { uploadFile } from "@/lib/file-client";
import { FILE_ACCEPT, fileUrl } from "@/lib/files";
import type { Task, TaskFile, EntityRef } from "@/lib/types";
import { Button } from "./ui/button";
import { useImagePreview } from "./image-preview";
import { entityNames } from "@/lib/entities";
import styles from "./task-documents.module.css";

function formatSize(bytes: number) {
  if (bytes === 0) return "0 KB";
  if (bytes < 1048576)
    return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString("es-CO")} KB`;
  return `${(bytes / 1048576).toLocaleString("es-CO", { maximumFractionDigits: 1 })} MB`;
}

function fileAppearance(file: TaskFile) {
  const extension = file.name.split(".").pop()?.toUpperCase() ?? "";
  if (file.mimeType.startsWith("image/"))
    return { kind: "image", label: "Imagen", extension, Icon: ImageIcon };
  if (file.mimeType === "application/pdf")
    return { kind: "pdf", label: "PDF", extension: "PDF", Icon: FileText };
  if (["XLS", "XLSX"].includes(extension))
    return { kind: "sheet", label: "Excel", extension, Icon: FileSpreadsheet };
  if (["DOC", "DOCX"].includes(extension))
    return { kind: "word", label: "Word", extension, Icon: FileText };
  return { kind: "file", label: "Documento", extension, Icon: FileIcon };
}

function FileThumbnail({ file }: { file: TaskFile }) {
  const [failed, setFailed] = useState(false);
  const { kind, extension, Icon } = fileAppearance(file);
  return (
    <span className={styles.thumbnail} data-kind={kind}>
      {kind === "image" && !failed ? (
        <>
          {/* Load authenticated files directly with the user's session. */}
          <img
            src={fileUrl(file.id)}
            alt=""
            width={64}
            height={56}
            loading="lazy"
            decoding="async"
            onError={() => setFailed(true)}
          />
          <span className={styles.thumbnailZoom} aria-hidden="true">
            <ZoomIn size={17} />
          </span>
        </>
      ) : (
        <>
          <Icon size={23} strokeWidth={1.6} aria-hidden="true" />
          <span>{extension.slice(0, 5)}</span>
        </>
      )}
    </span>
  );
}

const noFiles: TaskFile[] = [];
export function TaskDocuments({
  task,
  ...props
}: {
  task: Task;
  limit: number;
  onCountChange?: (count: number) => void;
}) {
  return (
    <EntityDocuments
      {...props}
      scope={{ kind: "task", id: task.id, projectId: task.projectId }}
      files={task.files}
      canEdit={task.permissions?.canEdit ?? true}
    />
  );
}

export function EntityDocuments({
  scope,
  files: sourceFiles,
  canEdit,
  limit,
  onCountChange,
}: {
  scope: EntityRef;
  files?: TaskFile[];
  canEdit: boolean;
  limit: number;
  onCountChange?: (count: number) => void;
}) {
  const initialFiles = sourceFiles ?? noFiles;
  const [files, setFiles] = useState(initialFiles);
  const [upload, setUpload] = useState<{
    name: string;
    progress: number;
    index: number;
    total: number;
  } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const openImage = useImagePreview();
  const input = useRef<HTMLInputElement>(null);
  const uploading = useRef(false);
  const dragDepth = useRef(0);
  const inputId = useId();
  const headingId = useId();
  const totalSize = files.reduce((total, file) => total + file.size, 0);
  useEffect(() => {
    setFiles(initialFiles);
  }, [scope.kind, scope.id, initialFiles]);
  useEffect(() => {
    onCountChange?.(files.length);
  }, [files.length, onCountChange]);

  async function attachFiles(selected: File[]) {
    if (!canEdit || uploading.current || !selected.length) return;
    uploading.current = true;
    try {
      for (const [index, file] of selected.entries()) {
        if (file.size > limit) {
          toast.error(`${file.name} supera el límite de ${formatSize(limit)}.`);
          continue;
        }
        const extension = `.${file.name.split(".").pop()?.toLowerCase()}`;
        if (!FILE_ACCEPT.split(",").includes(extension)) {
          toast.error(`${file.name}: el formato no es compatible.`);
          continue;
        }
        setUpload({
          name: file.name,
          progress: 0,
          index: index + 1,
          total: selected.length,
        });
        try {
          const uploaded = await uploadFile(
            file,
            scope.projectId,
            scope,
            "document",
            (progress) =>
              setUpload((current) => current && { ...current, progress }),
          );
          setFiles((current) => [...current, uploaded]);
        } catch (error) {
          toast.error((error as Error).message);
        }
      }
    } finally {
      uploading.current = false;
      setUpload(null);
    }
  }

  async function removeFile(file: TaskFile) {
    setDeletingId(file.id);
    try {
      const response = await fetch(`/api/files/${file.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "No se pudo eliminar el archivo.");
      }
      setFiles((current) => current.filter((item) => item.id !== file.id));
      toast.success("Archivo eliminado.");
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section
      className={styles.documents}
      aria-labelledby={headingId}
      onDragEnter={(event) => {
        if (!canEdit || !event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        dragDepth.current += 1;
        if (!uploading.current) setDragging(true);
      }}
      onDragOver={(event) => {
        if (!canEdit || !event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = uploading.current ? "none" : "copy";
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (!dragDepth.current) setDragging(false);
      }}
      onDrop={(event) => {
        if (!canEdit || !event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        void attachFiles(Array.from(event.dataTransfer.files));
      }}
    >
      <header className={styles.header}>
        <div className={styles.heading}>
          <h3 id={headingId}>
            Archivos{" "}
            {scope.kind === "task" || scope.kind === "feature"
              ? "de la"
              : "del"}{" "}
            {entityNames[scope.kind]}
          </h3>
          <p>
            {files.length
              ? `${files.length} ${files.length === 1 ? "archivo adjunto" : "archivos adjuntos"} · ${formatSize(totalSize)}`
              : "Toda la información de apoyo, en un solo lugar."}
          </p>
        </div>
        {canEdit && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={styles.attachButton}
            disabled={upload !== null}
            onClick={() => input.current?.click()}
          >
            <Plus size={15} aria-hidden="true" />
            Adjuntar archivos
          </Button>
        )}
      </header>
      <input
        ref={input}
        id={inputId}
        className="sr-only"
        type="file"
        accept={FILE_ACCEPT}
        aria-label="Adjuntar documentos"
        multiple
        disabled={!canEdit || upload !== null}
        onChange={(event) => {
          const selected = Array.from(event.target.files ?? []);
          event.target.value = "";
          void attachFiles(selected);
        }}
      />
      {canEdit && (
        <button
          type="button"
          className={styles.dropzone}
          data-dragging={dragging}
          disabled={upload !== null}
          aria-controls={inputId}
          onClick={() => input.current?.click()}
        >
          <span className={styles.uploadIcon}>
            <UploadCloud size={22} strokeWidth={1.6} aria-hidden="true" />
          </span>
          <span className={styles.dropzoneCopy}>
            <strong>
              {dragging
                ? "Suelta los archivos para adjuntarlos"
                : "Arrastra tus archivos aquí"}
            </strong>
            <span>
              o{" "}
              <span className={styles.selectLink}>
                selecciona desde tu equipo
              </span>
            </span>
          </span>
          <span className={styles.formats}>
            PDF, Word, Excel e imágenes
            <span>Hasta {formatSize(limit)} por archivo</span>
          </span>
        </button>
      )}
      {upload && (
        <div className={styles.uploadProgress} role="status" aria-live="polite">
          <Loader2 size={18} className={styles.spinner} aria-hidden="true" />
          <div>
            <div className={styles.uploadLabel}>
              <span>Cargando {upload.name}</span>
              <span>{upload.progress}%</span>
            </div>
            <progress
              aria-label={`Progreso de carga de ${upload.name}`}
              max={100}
              value={upload.progress}
            />
            {upload.total > 1 && (
              <small>
                Archivo {upload.index} de {upload.total}
              </small>
            )}
          </div>
        </div>
      )}
      {files.length ? (
        <ul className={styles.list} aria-label="Archivos adjuntos">
          {files.map((file) => {
            const { kind, label, extension } = fileAppearance(file);
            const isImage = kind === "image";
            const content = (
              <>
                <FileThumbnail file={file} />
                <span className={styles.fileInfo}>
                  <span className={styles.fileName} title={file.name}>
                    {file.name}
                  </span>
                  <span className={styles.fileMeta}>
                    <span className={styles.fileType} data-kind={kind}>
                      {label}
                    </span>
                    {isImage && <span>{extension}</span>}
                    <span>{formatSize(file.size)}</span>
                  </span>
                </span>
              </>
            );
            return (
              <li
                key={file.id}
                className={styles.row}
                aria-busy={deletingId === file.id}
              >
                {isImage ? (
                  <button
                    type="button"
                    className={styles.fileLink}
                    onClick={(event) => {
                      openImage(
                        {
                          src: fileUrl(file.id),
                          name: file.name,
                          meta: `${extension} · ${formatSize(file.size)}`,
                        },
                        event.currentTarget,
                      );
                    }}
                    aria-label={`Vista previa de ${file.name}`}
                  >
                    {content}
                  </button>
                ) : (
                  <a
                    className={styles.fileLink}
                    href={fileUrl(file.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Abrir ${file.name} en otra pestaña`}
                  >
                    {content}
                  </a>
                )}
                <div className={styles.actions}>
                  <a
                    className={styles.action}
                    href={`${fileUrl(file.id)}?download=1`}
                    aria-label={`Descargar ${file.name}`}
                    title="Descargar archivo"
                  >
                    <Download size={16} aria-hidden="true" />
                  </a>
                  {canEdit && (
                    <button
                      type="button"
                      className={`${styles.action} ${styles.deleteAction}`}
                      disabled={upload !== null || deletingId !== null}
                      aria-label={`Eliminar ${file.name}`}
                      title="Eliminar archivo"
                      onClick={() => void removeFile(file)}
                    >
                      {deletingId === file.id ? (
                        <Loader2
                          size={16}
                          className={styles.spinner}
                          aria-hidden="true"
                        />
                      ) : (
                        <Trash2 size={16} aria-hidden="true" />
                      )}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}>
            <Paperclip size={21} strokeWidth={1.5} aria-hidden="true" />
          </span>
          <strong>Aún no hay archivos adjuntos</strong>
          <p>
            {canEdit
              ? "Añade documentos, referencias o imágenes"
              : "Aquí encontrarás los documentos compartidos"}{" "}
            para dar contexto a{" "}
            {scope.kind === "task" || scope.kind === "feature"
              ? "esta"
              : "este"}{" "}
            {entityNames[scope.kind]}.
          </p>
        </div>
      )}
    </section>
  );
}
