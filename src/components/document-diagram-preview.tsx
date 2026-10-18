"use client";

import { useEffect, useRef, useState } from "react";
import { GitBranch, Loader2, ExternalLink } from "lucide-react";
import type { EntityRef } from "@/lib/types";
import type { DiagramDocument } from "@/lib/diagrams";
import { diagramReferencePath } from "@/lib/documents";
import styles from "./documents.module.css";

const inflight = new Map<
  string,
  Promise<{ diagram: DiagramDocument; blob: Blob | null }>
>();
async function preview(scope: EntityRef, id: string) {
  const key = `${scope.kind}/${scope.id}/${id}`;
  const existing = inflight.get(key);
  if (existing) return existing;
  const promise = (async () => {
    const response = await fetch(
      `/api/entities/${scope.kind}/${encodeURIComponent(scope.id)}/document-diagrams/${encodeURIComponent(id)}`,
      { cache: "no-store" },
    );
    if (!response.ok) throw new Error("Diagrama no disponible");
    const diagram: DiagramDocument = await response.json();
    const elements = diagram.scene.elements.filter(
      (element) => !element.isDeleted,
    );
    if (!elements.length) return { diagram, blob: null };
    (
      window as Window & { EXCALIDRAW_ASSET_PATH?: string }
    ).EXCALIDRAW_ASSET_PATH = "/excalidraw/";
    const { exportToBlob } = await import("@excalidraw/excalidraw");
    const blob = await exportToBlob({
      elements: elements as unknown as Parameters<
        typeof exportToBlob
      >[0]["elements"],
      files: diagram.scene.files,
      appState: {
        ...diagram.scene.appState,
        exportBackground: true,
        exportWithDarkMode: false,
      },
      maxWidthOrHeight: 192,
      mimeType: "image/png",
    });
    return { diagram, blob };
  })();
  inflight.set(key, promise);
  try {
    return await promise;
  } finally {
    inflight.delete(key);
  }
}

export function DocumentDiagramPreview({
  scope,
  diagramId,
  projectId,
}: {
  scope: EntityRef;
  diagramId: string;
  projectId: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [title, setTitle] = useState("Diagrama");
  const [description, setDescription] = useState("");
  const [image, setImage] = useState("");
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    if (root.current) observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    let active = true,
      generation = 0,
      objectUrl = "";
    async function load() {
      const current = ++generation;
      try {
        if (scope.projectId !== projectId)
          throw new Error("Diagrama no disponible");
        const result = await preview(scope, diagramId);
        if (!active || current !== generation) return;
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = result.blob ? URL.createObjectURL(result.blob) : "";
        setImage(objectUrl);
        setTitle(result.diagram.title);
        setDescription(result.diagram.description);
        setError("");
        setReady(true);
      } catch (error) {
        if (active && current === generation) {
          setError((error as Error).message);
          setImage("");
          setReady(false);
        }
      }
    }
    const focused = () => {
      if (document.visibilityState === "visible") void load();
    };
    void load();
    window.addEventListener("focus", focused);
    document.addEventListener("visibilitychange", focused);
    return () => {
      active = false;
      window.removeEventListener("focus", focused);
      document.removeEventListener("visibilitychange", focused);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [visible, scope.kind, scope.id, scope.projectId, projectId, diagramId]);
  return (
    <div ref={root} className={styles.diagramPreview} contentEditable={false}>
      {error ? (
        <div className={styles.diagramState} role="status">
          <span className={styles.diagramThumbnail}>
            <GitBranch size={22} />
          </span>
          <span>Diagrama no disponible</span>
        </div>
      ) : ready ? (
        <a
          className={styles.diagramLink}
          href={diagramReferencePath(projectId, diagramId)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Abrir diagrama ${title} en Draw`}
        >
          <span className={styles.diagramThumbnail}>
            {image ? (
              <img src={image} alt={`Vista previa de ${title}`} />
            ) : (
              <GitBranch size={24} aria-label="Diagrama vacío" />
            )}
          </span>
          <span className={styles.diagramText}>
            <strong className={styles.diagramTitle} title={title}>
              {title}
            </strong>
            <span className={styles.diagramDescription}>
              {description || "Sin descripción"}
            </span>
          </span>
          <ExternalLink
            size={14}
            className={styles.diagramOpenIcon}
            aria-hidden="true"
          />
        </a>
      ) : (
        <div className={styles.diagramState} role="status">
          <span className={styles.diagramThumbnail}>
            <Loader2 className="animate-spin" size={20} />
          </span>
          <span>Cargando diagrama…</span>
        </div>
      )}
    </div>
  );
}
