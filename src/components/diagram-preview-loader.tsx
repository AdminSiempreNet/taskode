"use client";
import dynamic from "next/dynamic";

export const DocumentDiagramPreview = dynamic(
  () =>
    import("./document-diagram-preview").then(
      (module) => module.DocumentDiagramPreview,
    ),
  { ssr: false, loading: () => <div role="status">Cargando diagrama…</div> },
);
