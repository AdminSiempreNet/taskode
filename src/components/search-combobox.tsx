"use client";

import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { Check, ChevronsUpDown, Plus, Search } from "lucide-react";
import { Popover } from "radix-ui";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { normalizeClientText } from "@/lib/clients";
import { UserAvatar } from "./user-avatar";

export type SearchOption = {
  id: string;
  name: string;
  secondary?: string;
  group?: string;
  image?: string | null;
};

function OptionContent({ option }: { option: SearchOption }) {
  return (
    <span className="search-option-content">
      {option.image !== undefined && (
        <UserAvatar name={option.name} image={option.image} />
      )}
      <span className="client-option-text">
        <span>{option.name}</span>
        {option.secondary && <small>{option.secondary}</small>}
      </span>
    </span>
  );
}

export function SearchCombobox({
  id,
  label,
  options,
  values,
  onChange,
  multiple = false,
  disabled,
  onCreate,
  triggerRef,
  placeholder,
}: {
  id: string;
  label: string;
  options: SearchOption[];
  values: string[];
  onChange: (values: string[]) => void;
  multiple?: boolean;
  disabled?: boolean;
  onCreate?: (query: string) => void;
  triggerRef?: RefObject<HTMLButtonElement | null>;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const creating = useRef(false);
  const listId = useId();
  const filtered = options
    .filter((option) =>
      normalizeClientText(
        `${option.name} ${option.secondary ?? ""} ${option.group ?? ""}`,
      ).includes(normalizeClientText(query)),
    )
    .sort(
      (a, b) =>
        (a.group ?? "").localeCompare(b.group ?? "", "es") ||
        a.name.localeCompare(b.name, "es"),
    );
  const index = Math.min(active, Math.max(0, filtered.length - 1));
  const current = filtered[index];
  const selected = options.filter((option) => values.includes(option.id));
  const groups = [...new Set(filtered.map((option) => option.group ?? ""))];
  useEffect(() => {
    if (open && current)
      document
        .getElementById(`${listId}-${current.id}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [open, current?.id, listId]);
  function select(value: string) {
    if (disabled) return;
    onChange(
      multiple
        ? values.includes(value)
          ? values.filter((id) => id !== value)
          : [...values, value]
        : [value],
    );
    if (!multiple) setOpen(false);
  }
  function changeOpen(next: boolean) {
    setOpen(next);
    if (next) {
      setQuery("");
      setActive(0);
    }
  }
  return (
    <Popover.Root open={open} onOpenChange={changeOpen}>
      <Popover.Trigger asChild>
        <Button
          id={id}
          ref={triggerRef}
          type="button"
          variant="outline"
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          aria-controls={listId}
          aria-haspopup="listbox"
          aria-required={!multiple}
          disabled={disabled}
          className={`catalog-combobox-trigger client-combobox-trigger${multiple ? " client-combobox-add-trigger" : ""}`}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              changeOpen(true);
            }
          }}
        >
          {multiple && <Search size={14} aria-hidden="true" />}
          <span className="client-combobox-summary">
            {multiple ? (
              <span>{placeholder ?? "Agregar cliente…"}</span>
            ) : selected.length ? (
              selected.map((option) => (
                <OptionContent option={option} key={option.id} />
              ))
            ) : (
              <span>{placeholder ?? "Selecciona una ciudad"}</span>
            )}
          </span>
          <ChevronsUpDown size={14} />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="catalog-combobox-panel client-combobox-panel"
          align="start"
          sideOffset={6}
          collisionPadding={12}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            input.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            if (creating.current) {
              event.preventDefault();
              creating.current = false;
            }
          }}
        >
          <div className="catalog-combobox-search">
            <Search size={15} />
            <Input
              ref={input}
              role="combobox"
              aria-label={`Buscar ${label.toLocaleLowerCase("es")}`}
              placeholder={
                placeholder ??
                (multiple
                  ? "Buscar cliente, ciudad o departamento…"
                  : "Buscar ciudad o departamento…")
              }
              aria-expanded={open}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={
                current ? `${listId}-${current.id}` : undefined
              }
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              onKeyDown={(event) => {
                if (
                  ["ArrowDown", "ArrowUp", "Home", "End", "Enter"].includes(
                    event.key,
                  )
                )
                  event.preventDefault();
                if (event.key === "ArrowDown")
                  setActive(
                    Math.min(index + 1, Math.max(0, filtered.length - 1)),
                  );
                if (event.key === "ArrowUp") setActive(Math.max(0, index - 1));
                if (event.key === "Home") setActive(0);
                if (event.key === "End")
                  setActive(Math.max(0, filtered.length - 1));
                if (event.key === "Enter" && current) select(current.id);
              }}
            />
          </div>
          <div
            id={listId}
            role="listbox"
            aria-label={label}
            aria-multiselectable={multiple || undefined}
            className="catalog-combobox-options"
          >
            {groups.map((group, groupIndex) => (
              <div
                key={group}
                role={group ? "group" : undefined}
                aria-labelledby={
                  group ? `${listId}-group-${groupIndex}` : undefined
                }
              >
                {group && (
                  <div
                    className="feature-combobox-group"
                    id={`${listId}-group-${groupIndex}`}
                  >
                    {group}
                  </div>
                )}
                {filtered
                  .filter((option) => (option.group ?? "") === group)
                  .map((option) => (
                    <button
                      key={option.id}
                      id={`${listId}-${option.id}`}
                      type="button"
                      role="option"
                      tabIndex={-1}
                      aria-selected={values.includes(option.id)}
                      data-active={current?.id === option.id}
                      disabled={disabled}
                      onMouseEnter={() => setActive(filtered.indexOf(option))}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => select(option.id)}
                    >
                      <OptionContent option={option} />
                      {values.includes(option.id) && <Check size={14} />}
                    </button>
                  ))}
              </div>
            ))}
            {!filtered.length && <p>No se encontraron opciones.</p>}
          </div>
          {onCreate && (
            <Button
              type="button"
              variant="ghost"
              className="client-create-option"
              disabled={disabled}
              onClick={() => {
                creating.current = true;
                setOpen(false);
                onCreate(query.trim());
              }}
            >
              <Plus size={15} />
              Crear cliente{query.trim() ? ` «${query.trim()}»` : ""}…
            </Button>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
