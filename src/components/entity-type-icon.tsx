import { Box, FolderKanban, Layers3, ListTodo } from "lucide-react";
import type { EntityKind } from "@/lib/types";

const icons = {
  project: FolderKanban,
  module: Box,
  feature: Layers3,
  task: ListTodo,
};
const names = {
  project: "Proyecto",
  module: "Módulo",
  feature: "Feature",
  task: "Tarea",
};

export function EntityTypeIcon({ kind }: { kind: EntityKind }) {
  const Icon = icons[kind];
  return (
    <span
      className="entity-type-icon"
      role="img"
      aria-label={names[kind]}
      title={names[kind]}
    >
      <Icon size={23} aria-hidden="true" />
    </span>
  );
}
