"use client";

import { useRef } from "react";
import { FolderKanban, Plus } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Project } from "@/lib/types";

const CREATE_PROJECT = "__create_project__";

export function ProjectSelector({
  projects,
  project,
  loading,
  disabled,
  onSelect,
  onCreate,
}: {
  projects: Project[];
  project?: Project;
  loading: boolean;
  disabled: boolean;
  onSelect: (id: string) => void;
  onCreate: () => void;
}) {
  const creating = useRef(false);

  return (
    <div className="sidebar-projects">
      <Select
        value={project?.id ?? ""}
        disabled={disabled || loading}
        onValueChange={(value) => {
          if (value === CREATE_PROJECT) {
            creating.current = true;
            onCreate();
          } else {
            onSelect(value);
          }
        }}
      >
        <SelectTrigger
          className="project-selector"
          aria-label={
            project
              ? `Cambiar proyecto. Actual: ${project.name}`
              : "Seleccionar proyecto"
          }
          title={project?.name ?? "Seleccionar proyecto"}
        >
          <SelectValue className="project-selector-value">
            <span
              className="project-selector-icon"
              style={{ background: project ? project.color + "15" : undefined }}
              aria-hidden="true"
            >
              {project?.icon ?? <FolderKanban size={18} />}
            </span>
            <span className="project-selector-text">
              <span className="project-selector-name">
                {loading
                  ? "Cargando proyectos…"
                  : (project?.name ?? "Sin proyectos")}
              </span>
            </span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent
          className="project-options"
          position="popper"
          align="start"
          sideOffset={4}
          collisionPadding={12}
          onCloseAutoFocus={(event) => {
            if (creating.current) {
              event.preventDefault();
              creating.current = false;
            }
          }}
        >
          <SelectGroup>
            <SelectLabel>Mis proyectos</SelectLabel>
            {projects.map((item) => (
              <SelectItem
                key={item.id}
                value={item.id}
                textValue={item.name}
                title={item.name}
                className="project-option"
              >
                <span
                  className="project-option-icon"
                  style={{ background: item.color + "15" }}
                  aria-hidden="true"
                >
                  {item.icon}
                </span>
                <span className="project-option-name">{item.name}</span>
              </SelectItem>
            ))}
          </SelectGroup>
          <SelectSeparator />
          <SelectItem
            value={CREATE_PROJECT}
            textValue="Nuevo proyecto"
            className="create-project-option"
          >
            <Plus size={16} />
            Nuevo proyecto
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
