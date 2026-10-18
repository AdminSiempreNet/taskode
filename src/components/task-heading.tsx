"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, Plus, Search, Tags } from "lucide-react";
import { Popover, Tooltip } from "radix-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { colorStyle, useProjectCatalog } from "./project-catalog";
import type { Mutate } from "./forms";

export function InlineTaskTitle({
  value,
  change,
  commit,
  busy,
}: {
  value: string;
  change: (value: string) => void;
  commit: (value: string) => void;
  busy: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const initialValue = useRef(value);
  const beforeEdit = useRef(value);
  const cancelled = useRef(false);
  useEffect(() => {
    if (ref.current && ref.current.textContent !== value)
      ref.current.textContent = value;
  }, [value]);
  return (
    <h1 className="inline-task-title">
      <span
        ref={ref}
        role="textbox"
        aria-label="Título de la tarea"
        aria-multiline="false"
        contentEditable={!busy ? "plaintext-only" : false}
        suppressContentEditableWarning
        tabIndex={0}
        data-placeholder="Escribe el título de la tarea…"
        title="Clic para editar · Enter para guardar · Escape para cancelar"
        onFocus={() => {
          beforeEdit.current = value;
          cancelled.current = false;
        }}
        onInput={(event) => {
          const text = event.currentTarget.textContent ?? "";
          if (text.length > 300) {
            event.currentTarget.textContent = text.slice(0, 300);
            const selection = window.getSelection();
            selection?.selectAllChildren(event.currentTarget);
            selection?.collapseToEnd();
          }
          change(text.slice(0, 300));
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            cancelled.current = true;
            change(beforeEdit.current);
            event.currentTarget.textContent = beforeEdit.current;
            event.currentTarget.blur();
          }
        }}
        onBlur={(event) => {
          if (!cancelled.current) commit(event.currentTarget.textContent ?? "");
        }}
      >
        {initialValue.current}
      </span>
      <span className="sr-only">{busy ? "Guardando…" : ""}</span>
    </h1>
  );
}

export function TaskLabelPicker({
  projectId,
  selected,
  change,
  mutate,
  busy,
}: {
  projectId: string;
  selected: string[];
  change: (value: string[]) => void;
  mutate: Mutate;
  busy: boolean;
}) {
  const { labels } = useProjectCatalog();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [color, setColor] = useState("#3b82f6");
  const [active, setActive] = useState(0);
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const filtered = labels.filter((label) =>
    label.name.toLocaleLowerCase("es").includes(search.toLocaleLowerCase("es")),
  );
  const toggle = (name: string) => {
    if (selected.includes(name))
      change(selected.filter((label) => label !== name));
    else if (selected.length < 20) change([...selected, name]);
  };
  useEffect(() => {
    if (open)
      document
        .getElementById(`${listId}-${filtered[active]?.id}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [active, open, listId, filtered]);
  return (
    <div className="task-title-labels" aria-label="Etiquetas de la tarea">
      <Tooltip.Provider delayDuration={200}>
        <div className="selected-labels">
          {selected.map((name) => (
            <Tooltip.Root key={name}>
              <Tooltip.Trigger asChild>
                <span
                  className="task-label-dot"
                  style={colorStyle(
                    labels.find((label) => label.name === name)?.color,
                  )}
                  role="img"
                  aria-label={name}
                  tabIndex={0}
                />
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content
                  className="task-label-tooltip"
                  sideOffset={6}
                  collisionPadding={12}
                >
                  {name}
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
          ))}
        </div>
      </Tooltip.Provider>
      <Popover.Root
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          if (value) {
            setSearch("");
            setActive(0);
          }
        }}
      >
        <Popover.Trigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="label-combobox-trigger"
            aria-label="Agregar o quitar etiquetas"
            title="Agregar o quitar etiquetas"
            disabled={busy}
          >
            <Tags size={15} aria-hidden="true" />
          </Button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            className="label-combobox-panel"
            align="end"
            sideOffset={8}
            collisionPadding={12}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              input.current?.focus();
            }}
          >
            <div className="label-combobox-search">
              <Search size={15} />
              <Input
                ref={input}
                role="combobox"
                aria-label="Buscar etiquetas"
                aria-expanded={open}
                aria-autocomplete="list"
                aria-controls={listId}
                aria-activedescendant={
                  filtered[active]
                    ? `${listId}-${filtered[active].id}`
                    : undefined
                }
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setActive(0);
                }}
                maxLength={60}
                placeholder="Buscar o crear etiqueta…"
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setActive((i) => Math.min(i + 1, filtered.length - 1));
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setActive((i) => Math.max(0, i - 1));
                  }
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (filtered[active] && !busy)
                      toggle(filtered[active].name);
                  }
                }}
              />
            </div>
            <div
              id={listId}
              className="label-combobox-options"
              role="listbox"
              aria-label="Etiquetas disponibles"
              aria-multiselectable="true"
            >
              {filtered.map((label, index) => (
                <button
                  id={`${listId}-${label.id}`}
                  key={label.id}
                  type="button"
                  role="option"
                  aria-selected={selected.includes(label.name)}
                  data-active={active === index}
                  disabled={
                    busy ||
                    (!selected.includes(label.name) && selected.length >= 20)
                  }
                  tabIndex={-1}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => toggle(label.name)}
                >
                  <span
                    className="label-color-bar"
                    style={colorStyle(label.color)}
                  />
                  <span>{label.name}</span>
                  <span className="label-option-check">
                    {selected.includes(label.name) && <Check size={14} />}
                  </span>
                </button>
              ))}
              {!filtered.length && (
                <p className="field-hint">No hay etiquetas con ese nombre.</p>
              )}
            </div>
            {search.trim() &&
              !labels.some(
                (label) =>
                  label.name.toLocaleLowerCase("es") ===
                  search.trim().toLocaleLowerCase("es"),
              ) && (
                <div className="inline-label-create">
                  <input
                    type="color"
                    aria-label="Color de la nueva etiqueta"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy || selected.length >= 20}
                    onClick={async () => {
                      const name = search.trim();
                      if (
                        await mutate({
                          type: "label.create",
                          projectId,
                          name,
                          color,
                        })
                      ) {
                        change([...selected, name]);
                        setSearch("");
                        setActive(0);
                        input.current?.focus();
                      }
                    }}
                  >
                    <Plus size={14} />
                    Crear «{search.trim()}»
                  </Button>
                </div>
              )}
            <div className="label-combobox-footer">
              <span>{selected.length}/20 seleccionadas</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setOpen(false)}
              >
                Listo
              </Button>
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
