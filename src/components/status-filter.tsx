"use client";

import { ChevronDown, SlidersHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Status } from "@/lib/types";

export function StatusFilter({
  statuses,
  selectedIds,
  onChange,
}: {
  statuses: Status[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const selected = statuses.filter((status) => selectedIds.includes(status.id));
  const label =
    selected.length === 0
      ? "Todos los estados"
      : selected.length === 1
        ? selected[0].name
        : `${selected.length} estados`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="status-filter"
          aria-label={`Filtrar por estados: ${label}`}
          title={
            selected.length
              ? selected.map((status) => status.name).join(", ")
              : label
          }
          data-active={selected.length > 0 || undefined}
        >
          <SlidersHorizontal size={14} />
          <span>{label}</span>
          <ChevronDown size={14} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="status-filter-menu"
        collisionPadding={8}
      >
        <DropdownMenuLabel>Filtrar por estados</DropdownMenuLabel>
        <DropdownMenuCheckboxItem
          checked={!selected.length}
          onCheckedChange={() => onChange([])}
          onSelect={(event) => event.preventDefault()}
        >
          Todos los estados
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        {statuses.map((status) => (
          <DropdownMenuCheckboxItem
            key={status.id}
            checked={selectedIds.includes(status.id)}
            onCheckedChange={(checked) =>
              onChange(
                checked
                  ? [...selectedIds, status.id]
                  : selectedIds.filter((id) => id !== status.id),
              )
            }
            onSelect={(event) => event.preventDefault()}
          >
            <i
              className="status-filter-dot"
              style={{ background: status.color }}
              aria-hidden="true"
            />
            <span>{status.name}</span>
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
