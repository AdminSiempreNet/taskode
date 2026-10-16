"use client";

import { createContext, useContext, type CSSProperties } from "react";
import type { ProjectLabel, ProjectPriority } from "@/lib/types";

export const ProjectCatalog = createContext<{
  priorities: ProjectPriority[];
  labels: ProjectLabel[];
}>({ priorities: [], labels: [] });
export const useProjectCatalog = () => useContext(ProjectCatalog);
export function colorStyle(color = "#64748b"): CSSProperties {
  return { "--chip-color": color } as CSSProperties;
}
export function LabelChip({ name }: { name: string }) {
  const { labels } = useProjectCatalog();
  return (
    <span
      className="label-chip colored-chip"
      style={colorStyle(labels.find((label) => label.name === name)?.color)}
    >
      <i />
      {name}
    </span>
  );
}
