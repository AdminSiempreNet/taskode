"use client";

import { createContext, useContext, type CSSProperties } from "react";
import type {
  ProjectLabel,
  ProjectPriority,
  ProjectTaskType,
  ProjectImpact,
} from "@/lib/types";

export const ProjectCatalog = createContext<{
  timeZone?: string;
  priorities: ProjectPriority[];
  taskTypes: ProjectTaskType[];
  impacts: ProjectImpact[];
  labels: ProjectLabel[];
}>({ priorities: [], taskTypes: [], impacts: [], labels: [] });
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

export function TaskCategoryChip({
  kind,
  id,
}: {
  kind: "type" | "impact";
  id: string | null;
}) {
  const { taskTypes, impacts } = useProjectCatalog();
  const option = (kind === "type" ? taskTypes : impacts).find(
    (item) => item.id === id,
  );
  if (!option) return null;
  return (
    <span
      className="label-chip colored-chip"
      style={colorStyle(option.color)}
      title={`${kind === "type" ? "Tipo" : "Impacto"}: ${option.name}`}
    >
      <i />
      {option.name}
    </span>
  );
}
