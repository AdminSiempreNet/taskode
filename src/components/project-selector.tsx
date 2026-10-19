"use client";

import { useRef, useState, type ReactElement } from "react";
import { Check, Plus, Search, Star } from "lucide-react";
import { Popover } from "radix-ui";
import { Input } from "@/components/ui/input";
import {
  PROJECT_SHORTCUT_LIMIT,
  rankProjects,
  searchProjects,
  type ProjectPreferences,
} from "@/lib/project-navigation";
import type { Project } from "@/lib/types";

export function ProjectSelector({
  children,
  projects,
  project,
  preferences,
  loading,
  disabled,
  onSelect,
  onToggleFavorite,
  onCreate,
}: {
  children: ReactElement;
  projects: Project[];
  project?: Project;
  preferences: ProjectPreferences;
  loading: boolean;
  disabled: boolean;
  onSelect: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  onCreate: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const creating = useRef(false);
  const matches = searchProjects(rankProjects(projects, preferences), query);
  const searching = query.trim().length > 0;
  const visible = searching ? matches : matches.slice(0, PROJECT_SHORTCUT_LIMIT);
  const unavailable = disabled || loading;

  function choose(action: () => void) {
    setOpen(false);
    action();
  }

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setQuery("");
      }}
    >
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="project-options"
          aria-label="Seleccionar proyecto"
          align="end"
          sideOffset={4}
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
          onKeyDown={(event) => {
            if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
            const buttons = Array.from(
              event.currentTarget.querySelectorAll<HTMLButtonElement>(
                "button[data-project-choice]:not(:disabled)",
              ),
            );
            if (!buttons.length) return;
            event.preventDefault();
            const index = buttons.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            const next =
              event.key === "ArrowDown"
                ? (index + 1) % buttons.length
                : index < 0
                  ? buttons.length - 1
                  : (index - 1 + buttons.length) % buttons.length;
            buttons[next].focus();
          }}
        >
          <div className="project-search">
            <Search size={15} aria-hidden="true" />
            <Input
              ref={input}
              aria-label="Buscar proyectos"
              placeholder="Buscar proyectos…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <p className="project-options-label">
            {searching ? "Resultados" : "Favoritos y recientes"}
          </p>
          <div className="project-options-list" aria-label="Proyectos">
            {visible.map((item) => {
              const favorite = preferences.favorites.includes(item.id);
              return (
                <div key={item.id} className="project-option-row">
                  <button
                    type="button"
                    className="project-option"
                    data-project-choice
                    aria-current={
                      project?.id === item.id ? "page" : undefined
                    }
                    disabled={unavailable}
                    title={item.name}
                    onClick={() => choose(() => onSelect(item.id))}
                  >
                    <span
                      className="project-option-icon"
                      style={{ background: item.color + "15" }}
                      aria-hidden="true"
                    >
                      {item.icon}
                    </span>
                    <span className="project-option-name">{item.name}</span>
                    {project?.id === item.id && (
                      <Check size={15} aria-hidden="true" />
                    )}
                  </button>
                  <button
                    type="button"
                    className="project-favorite"
                    aria-label={`${favorite ? "Quitar de" : "Añadir a"} favoritos: ${item.name}`}
                    aria-pressed={favorite}
                    title={
                      favorite ? "Quitar de favoritos" : "Añadir a favoritos"
                    }
                    disabled={unavailable}
                    onClick={() => onToggleFavorite(item.id)}
                  >
                    <Star
                      size={15}
                      fill={favorite ? "currentColor" : "none"}
                      aria-hidden="true"
                    />
                  </button>
                </div>
              );
            })}
            {!visible.length && (
              <p className="project-search-empty" role="status">
                {projects.length
                  ? "No se encontraron proyectos."
                  : "Aún no tienes proyectos."}
              </p>
            )}
          </div>
          {matches.length > PROJECT_SHORTCUT_LIMIT && (
            <p className="project-search-hint" role="status">
              {searching
                ? `${matches.length} proyectos encontrados. Desplázate para ver más.`
                : `Mostrando ${PROJECT_SHORTCUT_LIMIT} de ${matches.length}. Busca para encontrar otros proyectos.`}
            </p>
          )}
          <button
            type="button"
            className="project-option create-project-option"
            data-project-choice
            disabled={unavailable}
            onClick={() => {
              creating.current = true;
              choose(onCreate);
            }}
          >
            <span className="project-option-icon" aria-hidden="true">
              <Plus size={16} />
            </span>
            Nuevo proyecto
          </button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
