"use client";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { GripVertical, X } from "lucide-react";
import type { EntityRef } from "@/lib/types";
import { DocumentDiagramPreview } from "./diagram-preview-loader";
import styles from "./documents.module.css";

export function DiagramReferenceView({
  node,
  extension,
  selected,
  editor,
  deleteNode,
}: NodeViewProps) {
  return (
    <NodeViewWrapper
      className={`${styles.diagramNode} ${selected ? styles.selectedDiagram : ""}`}
      contentEditable={false}
    >
      {editor.isEditable && (
        <button
          type="button"
          className={styles.diagramHandle}
          data-drag-handle
          aria-label="Arrastrar diagrama"
          title="Arrastrar diagrama"
        >
          <GripVertical size={15} />
        </button>
      )}
      <DocumentDiagramPreview
        scope={extension.options.scope as EntityRef}
        diagramId={node.attrs.diagramId}
        projectId={node.attrs.projectId}
      />
      {editor.isEditable && (
        <button
          type="button"
          className={styles.diagramRemove}
          aria-label="Quitar diagrama del documento"
          title="Quitar del documento"
          onMouseDown={(event) => event.preventDefault()}
          onClick={deleteNode}
        >
          <X size={14} />
        </button>
      )}
    </NodeViewWrapper>
  );
}
