"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { Popover } from "radix-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Option = { id: string; name: string; color: string | null };
const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es");

export function CatalogCombobox({
  id,
  label,
  options,
  value,
  onChange,
  emptyLabel,
  disabled,
  name,
  form,
}: {
  id: string;
  label: string;
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  emptyLabel?: string;
  disabled?: boolean;
  name?: string;
  form?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const entries: Option[] = emptyLabel
    ? [{ id: "", name: emptyLabel, color: null }, ...options]
    : options;
  const selected = entries.find((option) => option.id === value);
  const filtered = entries.filter((option) =>
    normalize(option.name).includes(normalize(query.trim())),
  );
  const activeIndex = Math.min(active, Math.max(0, filtered.length - 1));
  const activeOption = filtered[activeIndex];
  useEffect(() => {
    if (open && activeOption)
      document
        .getElementById(`${listId}-${activeOption.id || "empty"}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [open, activeOption?.id, listId]);
  function changeOpen(next: boolean) {
    setOpen(next);
    if (next) {
      setQuery("");
      setActive(
        Math.max(
          0,
          entries.findIndex((option) => option.id === value),
        ),
      );
    }
  }
  function select(id: string) {
    if (disabled) return;
    onChange(id);
    setOpen(false);
  }
  return (
    <>
      {name && (
        <input
          type="hidden"
          name={name}
          form={form}
          value={value}
          disabled={disabled}
        />
      )}
      <Popover.Root open={open} onOpenChange={changeOpen}>
        <Popover.Trigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-haspopup="listbox"
            aria-required={!emptyLabel}
            className="catalog-combobox-trigger"
            title={selected?.name}
            disabled={disabled || (!options.length && !emptyLabel)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                changeOpen(true);
              }
            }}
          >
            <span className="catalog-combobox-value">
              {selected?.color && (
                <i
                  className="catalog-combobox-color"
                  style={{ background: selected.color }}
                  aria-hidden="true"
                />
              )}
              <span>
                {selected?.name ??
                  `Selecciona ${label.toLocaleLowerCase("es")}`}
              </span>
            </span>
            <ChevronsUpDown size={14} />
          </Button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            className="catalog-combobox-panel"
            align="start"
            sideOffset={6}
            collisionPadding={12}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              input.current?.focus();
            }}
          >
            <div className="catalog-combobox-search">
              <Search size={15} />
              <Input
                ref={input}
                role="combobox"
                aria-label={`Buscar ${label.toLocaleLowerCase("es")}`}
                aria-expanded={open}
                aria-autocomplete="list"
                aria-controls={listId}
                aria-activedescendant={
                  activeOption
                    ? `${listId}-${activeOption.id || "empty"}`
                    : undefined
                }
                placeholder={`Buscar ${label.toLocaleLowerCase("es")}…`}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActive(0);
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setActive(
                      Math.min(
                        activeIndex + 1,
                        Math.max(0, filtered.length - 1),
                      ),
                    );
                  }
                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setActive(Math.max(0, activeIndex - 1));
                  }
                  if (event.key === "Home") {
                    event.preventDefault();
                    setActive(0);
                  }
                  if (event.key === "End") {
                    event.preventDefault();
                    setActive(Math.max(0, filtered.length - 1));
                  }
                  if (event.key === "Enter") {
                    event.preventDefault();
                    if (activeOption) select(activeOption.id);
                  }
                }}
              />
            </div>
            <div
              id={listId}
              role="listbox"
              aria-label={`Opciones de ${label.toLocaleLowerCase("es")}`}
              className="catalog-combobox-options"
            >
              {filtered.map((option, index) => (
                <button
                  key={option.id}
                  id={`${listId}-${option.id || "empty"}`}
                  type="button"
                  role="option"
                  aria-selected={value === option.id}
                  tabIndex={-1}
                  data-active={activeIndex === index}
                  disabled={disabled}
                  onMouseEnter={() => setActive(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => select(option.id)}
                >
                  <i
                    className="catalog-combobox-color"
                    style={{ background: option.color ?? "var(--border)" }}
                    aria-hidden="true"
                  />
                  <span>{option.name}</span>
                  {value === option.id && <Check size={14} />}
                </button>
              ))}
              {!filtered.length && <p>No se encontraron opciones.</p>}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </>
  );
}
