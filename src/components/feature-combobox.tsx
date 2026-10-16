"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { Popover } from "radix-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Feature, ProjectModule } from "@/lib/types";
import { formatFeatureNumber } from "@/lib/features";

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es");
}

export function FeatureCombobox({
  id,
  features,
  modules,
  value,
  onChange,
  disabled,
  name,
  form,
}: {
  id: string;
  features: Feature[];
  modules: ProjectModule[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  name?: string;
  form?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const selected = features.find((feature) => feature.id === value);
  const search = normalize(query.trim());
  const groups = [
    { id: "general", name: "General", description: "", code: "" },
    ...modules.map((module, index) => ({
      ...module,
      code: String(index + 1).padStart(2, "0"),
    })),
  ]
    .map((group) => ({
      ...group,
      features: features.filter(
        (feature) =>
          (feature.moduleId ?? "general") === group.id &&
          normalize(
            `${feature.name} ${feature.description} ${group.name} ${group.description} ${formatFeatureNumber(feature.number)}`,
          ).includes(search),
      ),
    }))
    .filter((group) => group.features.length > 0);
  const options = groups.flatMap((group) => group.features);
  useEffect(() => {
    if (open && options[active])
      document
        .getElementById(`${listId}-${options[active].id}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [active, open, listId, options]);
  function select(id: string) {
    onChange(id);
    setOpen(false);
  }
  return (
    <>
      {name && <input type="hidden" name={name} form={form} value={value} />}
      <Popover.Root
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) {
            setQuery("");
            setActive(0);
          }
        }}
      >
        <Popover.Trigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-haspopup="listbox"
            className="feature-combobox-trigger"
            disabled={disabled || !features.length}
          >
            <span>
              {selected
                ? `${formatFeatureNumber(selected.number)} · ${selected.name}`
                : "Selecciona una feature"}
            </span>
            <ChevronsUpDown size={14} />
          </Button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            className="feature-combobox-panel"
            align="start"
            sideOffset={6}
            collisionPadding={12}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              input.current?.focus();
            }}
          >
            <div className="feature-combobox-search">
              <Search size={15} />
              <Input
                ref={input}
                role="combobox"
                aria-label="Buscar features"
                aria-expanded={open}
                aria-autocomplete="list"
                aria-controls={listId}
                aria-activedescendant={
                  options[active]
                    ? `${listId}-${options[active].id}`
                    : undefined
                }
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActive(0);
                }}
                placeholder="Buscar feature o módulo…"
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setActive((index) =>
                      Math.min(index + 1, options.length - 1),
                    );
                  }
                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setActive((index) => Math.max(0, index - 1));
                  }
                  if (event.key === "Home") {
                    event.preventDefault();
                    setActive(0);
                  }
                  if (event.key === "End") {
                    event.preventDefault();
                    setActive(options.length - 1);
                  }
                  if (event.key === "Enter") {
                    event.preventDefault();
                    if (options[active] && !disabled)
                      select(options[active].id);
                  }
                }}
              />
            </div>
            <div
              id={listId}
              className="feature-combobox-options"
              role="listbox"
              aria-label="Features por módulo"
            >
              {groups.map((group) => (
                <div
                  key={group.id}
                  role="group"
                  aria-labelledby={`${listId}-group-${group.id}`}
                >
                  <div
                    className="feature-combobox-group"
                    id={`${listId}-group-${group.id}`}
                  >
                    {group.code && <span>{group.code}</span>}
                    {group.name}
                  </div>
                  {group.features.map((feature) => (
                    <button
                      type="button"
                      role="option"
                      id={`${listId}-${feature.id}`}
                      key={feature.id}
                      aria-selected={value === feature.id}
                      tabIndex={-1}
                      data-active={options[active]?.id === feature.id}
                      disabled={disabled}
                      onMouseEnter={() =>
                        setActive(
                          options.findIndex(
                            (option) => option.id === feature.id,
                          ),
                        )
                      }
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => select(feature.id)}
                    >
                      <span className="feature-number">
                        {formatFeatureNumber(feature.number)}
                      </span>
                      <span>{feature.name}</span>
                      {value === feature.id && <Check size={14} />}
                    </button>
                  ))}
                </div>
              ))}
              {!options.length && <p>No se encontraron features.</p>}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </>
  );
}
