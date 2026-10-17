"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import {
  Check,
  Flag,
  Monitor,
  Moon,
  Palette,
  Plus,
  Settings2,
  Sun,
  Tags,
  Shapes,
  Target,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { StatusesForm, type Confirmation, type Mutate } from "./forms";
import type {
  Project,
  ProjectLabel,
  ProjectPriority,
  Workspace,
} from "@/lib/types";

type Section =
  | "statuses"
  | "priorities"
  | "taskTypes"
  | "impacts"
  | "labels"
  | "appearance";
const catalogKinds = {
  priorities: "priority",
  taskTypes: "taskType",
  impacts: "impact",
  labels: "label",
} as const;
const catalogNouns = {
  priority: { singular: "prioridad", article: "la", fresh: "Nueva prioridad" },
  taskType: { singular: "tipo", article: "el", fresh: "Nuevo tipo" },
  impact: { singular: "impacto", article: "el", fresh: "Nuevo impacto" },
  label: { singular: "etiqueta", article: "la", fresh: "Nueva etiqueta" },
} as const;
const sections = {
  statuses: {
    title: "Estados del proyecto",
    description:
      "Define las etapas de tu flujo de trabajo y el orden de las columnas.",
    icon: Settings2,
  },
  priorities: {
    title: "Prioridades",
    description:
      "Personaliza los niveles de importancia de las tareas de este proyecto.",
    icon: Flag,
  },
  taskTypes: {
    title: "Tipos",
    description:
      "Personaliza los tipos de tarea de este proyecto. Su asignación es opcional.",
    icon: Shapes,
  },
  impacts: {
    title: "Impactos",
    description:
      "Define los ámbitos de impacto de este proyecto. Su asignación es opcional.",
    icon: Target,
  },
  labels: {
    title: "Etiquetas",
    description:
      "Organiza las tareas con nombres y colores que tengan sentido para tu proyecto.",
    icon: Tags,
  },
  appearance: {
    title: "Apariencia",
    description:
      "Elige cómo se ve Brote en este navegador. Se aplica a todos tus proyectos.",
    icon: Palette,
  },
};

export function SettingsModal({
  project,
  workspace,
  mutate: mutateWorkspace,
  busy,
  close,
  confirm,
}: {
  project?: Project;
  workspace: Workspace;
  mutate: Mutate;
  busy: boolean;
  close: () => void;
  confirm: (value: Confirmation) => void;
}) {
  const mutationQueue = useRef(Promise.resolve());
  const mutate = useCallback<Mutate>(
    (command) => {
      const result = mutationQueue.current.then(() => mutateWorkspace(command));
      mutationQueue.current = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
    [mutateWorkspace],
  );
  const [section, setSection] = useState<Section>(
    project ? "statuses" : "appearance",
  );
  const current = sections[section];
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
    >
      <DialogContent
        className="settings-dialog"
        onInteractOutside={(e) => {
          if (busy) e.preventDefault();
        }}
      >
        <DialogTitle className="sr-only">Configuración general</DialogTitle>
        <DialogDescription className="sr-only">
          Configuración del proyecto y preferencias globales de Brote.
        </DialogDescription>
        <nav className="settings-nav" aria-label="Secciones de configuración">
          <h2>Configuración</h2>
          <div className="settings-group-label">Proyecto</div>
          <p className="settings-project-name">
            {project
              ? `${project.icon} ${project.name}`
              : "Selecciona un proyecto"}
          </p>
          {(
            [
              "statuses",
              "priorities",
              "taskTypes",
              "impacts",
              "labels",
            ] as const
          ).map((id) => {
            const Icon = sections[id].icon;
            return (
              <button
                key={id}
                disabled={!project}
                aria-current={section === id ? "page" : undefined}
                onClick={() => setSection(id)}
              >
                <Icon size={17} />
                <span>
                  {id === "statuses" ? "Estados" : sections[id].title}
                </span>
              </button>
            );
          })}
          <div className="settings-group-label global-settings-label">
            Global
          </div>
          <button
            aria-current={section === "appearance" ? "page" : undefined}
            onClick={() => setSection("appearance")}
          >
            <Palette size={17} />
            <span>Apariencia</span>
          </button>
        </nav>
        <section className="settings-content" aria-label={current.title}>
          <header>
            <h2>{current.title}</h2>
            <p>{current.description}</p>
          </header>
          {section === "statuses" && project && (
            <StatusesForm
              statuses={workspace.statuses.filter(
                (s) => s.projectId === project.id,
              )}
              projectId={project.id}
              mutate={mutate}
              busy={busy}
            />
          )}
          {section !== "statuses" && section !== "appearance" && project && (
            <div className="form-stack settings-editor" key={section}>
              <p className="info-note">
                {section === "labels"
                  ? "Las etiquetas se comparten dentro de este proyecto. Al renombrar una etiqueta se actualizan sus tareas; al eliminarla se retira de ellas."
                  : "Los cambios de nombre y color se reflejan en todas las tareas. Para eliminar una opción, cambia o quita antes su asignación en las tareas que la usan, incluidas las archivadas."}
              </p>
              <div
                className="status-editor"
                role="region"
                aria-label={`Lista de ${sections[section].title.toLocaleLowerCase("es")}`}
                tabIndex={0}
              >
                {(workspace[section] ?? [])
                  .filter((option) => option.projectId === project.id)
                  .map((option) => (
                    <OptionRow
                      key={option.id}
                      option={option}
                      kind={catalogKinds[section]}
                      projectId={project.id}
                      mutate={mutate}
                      busy={busy}
                      confirm={confirm}
                    />
                  ))}
              </div>
              <OptionRow
                key={`new-${section}`}
                kind={catalogKinds[section]}
                projectId={project.id}
                mutate={mutate}
                busy={busy}
                confirm={confirm}
              />
            </div>
          )}
          {section === "appearance" && <Appearance />}
        </section>
      </DialogContent>
    </Dialog>
  );
}

function Appearance() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <div className="appearance-card">
      <h3>Tema de la aplicación</h3>
      <p>Un espacio cómodo para trabajar, de día o de noche.</p>
      <div
        className="theme-options"
        role="group"
        aria-label="Tema de la aplicación"
      >
        {(
          [
            { id: "light", title: "Claro", icon: Sun },
            { id: "dark", title: "Oscuro", icon: Moon },
            { id: "system", title: "Sistema", icon: Monitor },
          ] as const
        ).map(({ id, title, icon: Icon }) => (
          <button
            key={id}
            aria-pressed={mounted && theme === id}
            onClick={() => setTheme(id)}
          >
            <div className={`theme-preview theme-preview-${id}`}>
              <div />
              <div>
                <i />
                <i />
                <i />
              </div>
            </div>
            <span>
              <Icon size={16} />
              {title}
              {mounted && theme === id && <Check size={16} />}
            </span>
          </button>
        ))}
      </div>
      <p className="field-hint">
        Sistema sigue la preferencia de tu dispositivo automáticamente.
      </p>
    </div>
  );
}

function OptionRow({
  option,
  kind,
  projectId,
  mutate,
  busy,
  confirm,
}: {
  option?: ProjectPriority | ProjectLabel;
  kind: "priority" | "taskType" | "impact" | "label";
  projectId: string;
  mutate: Mutate;
  busy: boolean;
  confirm: (value: Confirmation) => void;
}) {
  const [name, setName] = useState(option?.name ?? "");
  const [color, setColor] = useState(option?.color ?? "#3b82f6");
  const lastSubmitted = useRef({ name, color });
  const { singular: noun, article, fresh } = catalogNouns[kind];
  async function save() {
    const values = { name: name.trim(), color };
    if (!values.name) {
      if (option) setName(option.name);
      toast.error("El nombre no puede estar vacío.");
      return;
    }
    if (
      option &&
      values.name === lastSubmitted.current.name &&
      values.color === lastSubmitted.current.color
    ) {
      setName(values.name);
      return;
    }
    const previous = lastSubmitted.current;
    lastSubmitted.current = values;
    if (
      await mutate({
        type: `${kind}.${option ? "update" : "create"}`,
        projectId,
        id: option?.id,
        ...values,
      })
    ) {
      setName((current) =>
        current === name ? (option ? values.name : "") : current,
      );
    } else if (lastSubmitted.current === values) {
      lastSubmitted.current = previous;
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    void save();
  }
  return (
    <form className="status-row catalog-row" onSubmit={submit}>
      <div className="status-row-main">
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          onBlur={option ? () => void save() : undefined}
          aria-label={`Color de ${option?.name ?? fresh.toLocaleLowerCase("es")}`}
        />
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={option ? () => void save() : undefined}
          maxLength={60}
          required
          placeholder={fresh}
          aria-label={`Nombre de ${option?.name ?? fresh.toLocaleLowerCase("es")}`}
        />
        {!option && (
          <Button
            type="submit"
            size="icon"
            aria-label={`Añadir ${noun}`}
            disabled={busy}
          >
            <Plus />
          </Button>
        )}
        {option && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="danger"
            disabled={busy}
            aria-label={`Eliminar ${option.name}`}
            onClick={() =>
              confirm({
                title: `¿Eliminar ${article} ${noun} «${option.name}»?`,
                description:
                  kind === "label"
                    ? "Se quitará de todas las tareas de este proyecto."
                    : "Solo se puede eliminar si ninguna tarea utiliza esta opción, incluidas las archivadas.",
                action: () =>
                  mutate({ type: `${kind}.delete`, projectId, id: option.id }),
              })
            }
          >
            <Trash2 />
          </Button>
        )}
      </div>
    </form>
  );
}
