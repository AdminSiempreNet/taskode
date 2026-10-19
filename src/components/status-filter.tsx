"use client";

import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UNASSIGNED_FILTER, validFilterIds } from "@/lib/task-filters";
import { readPreference } from "@/lib/preferences";
import { UserAvatar } from "./user-avatar";

type FilterOption = {
  id: string;
  name: string;
  color: string;
  email?: string;
  image?: string | null;
};

export function useProjectFilter(
  projectId: string,
  category: string,
  options: { id: string }[],
  optional = false,
  defaults: string[] = [],
) {
  const [selection, setSelection] = useState({
    projectId,
    ids: defaults,
  });
  useEffect(() => {
    let ids: string[] = defaults;
    try {
      const saved: unknown = JSON.parse(
        readPreference(`taskode.${category}-filter.${projectId}`) ??
          JSON.stringify(defaults),
      );
      if (Array.isArray(saved) && saved.every((id) => typeof id === "string"))
        ids = saved;
    } catch {
      // Invalid or unavailable storage falls back to showing all values.
    }
    setSelection({ projectId, ids });
  }, [projectId, category]);
  function onChange(ids: string[]) {
    setSelection({ projectId, ids });
    try {
      localStorage.setItem(
        `taskode.${category}-filter.${projectId}`,
        JSON.stringify(ids),
      );
    } catch {
      // Filtering also works when browser storage is unavailable.
    }
  }
  return [
    validFilterIds(
      selection.projectId === projectId ? selection.ids : defaults,
      options,
      optional,
    ),
    onChange,
  ] as const;
}

export function CatalogFilter({
  options,
  category,
  allLabel,
  shortLabel,
  unassignedLabel,
  selectedIds,
  onChange,
}: {
  options: FilterOption[];
  category: string;
  allLabel: string;
  shortLabel: string;
  unassignedLabel?: string;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const entries: FilterOption[] = unassignedLabel
    ? [
        { id: UNASSIGNED_FILTER, name: unassignedLabel, color: "#64748b" },
        ...options,
      ]
    : options;
  const selected = entries.filter((option) => selectedIds.includes(option.id));
  const label =
    selected.length === 0
      ? allLabel
      : selected.length === 1
        ? selected[0].name
        : `${selected.length} ${category}`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="status-filter"
          aria-label={`Filtrar por ${category}: ${label}`}
          title={
            selected.length
              ? selected.map((status) => status.name).join(", ")
              : label
          }
          data-active={selected.length > 0 || undefined}
        >
          <SlidersHorizontal size={14} />
          <span className={selected.length ? undefined : "filter-full-label"}>
            {label}
          </span>
          {!selected.length && (
            <span className="filter-short-label">{shortLabel}</span>
          )}
          <ChevronDown size={14} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className={`status-filter-menu${options.some((option) => option.email) ? " user-filter-menu" : ""}`}
        collisionPadding={8}
      >
        <DropdownMenuLabel>Filtrar por {category}</DropdownMenuLabel>
        <DropdownMenuCheckboxItem
          checked={!selected.length}
          onCheckedChange={() => onChange([])}
          onSelect={(event) => event.preventDefault()}
        >
          {allLabel}
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        {entries.map((status) => (
          <DropdownMenuCheckboxItem
            key={status.id}
            textValue={status.name}
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
            {status.email ? (
              <span className="search-option-content">
                <UserAvatar name={status.name} image={status.image} />
                <span className="client-option-text">
                  <span>{status.name}</span>
                  <small>{status.email}</small>
                </span>
              </span>
            ) : (
              <>
                <i
                  className="status-filter-dot"
                  style={{ background: status.color }}
                  aria-hidden="true"
                />
                <span>{status.name}</span>
              </>
            )}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
