"use client";
import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import {
  entityPath,
  getProjectView,
  taskPath,
  safeReturnTo,
} from "@/lib/routes";
import { useWorkspaceRouter } from "./unsaved-changes";
import { FeatureCombobox } from "./feature-combobox";
import { CatalogCombobox } from "./catalog-combobox";
import { ClientPicker } from "./client-picker";
import { formatFeatureNumber } from "@/lib/features";
import { EntityAssignments } from "./task-people";
import type { UserSummary } from "@/lib/types";
import { TaskPeopleFields } from "./task-people";
import { uploadFile } from "@/lib/file-client";
import { DescriptionEditor } from "./description-editor";
import { EmojiPicker } from "./emoji-picker";
import type { TaskDefaults } from "./task-detail";
import {
  ArrowDown,
  ArrowUp,
  Check,
  FileJson,
  Loader2,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  COLORS,
  type Feature,
  type ProjectModule,
  type Project,
  type Status,
  type Workspace,
  type ImportReport,
} from "@/lib/types";
import { trelloSchema, type TrelloBoard } from "@/lib/validation";

export type MutationResult = { createdId?: string; report?: ImportReport };
export type Mutate = (command: unknown) => Promise<MutationResult | null>;
export type Modal =
  | { type: "project"; project?: Project }
  | { type: "feature"; feature?: Feature; moduleId?: string | null }
  | { type: "module"; module?: ProjectModule }
  | { type: "task"; defaults?: TaskDefaults }
  | { type: "import" };
export type Confirmation = {
  title: string;
  description: string;
  action: () => Promise<unknown>;
};
export function Confirm({
  value,
  close,
  busy,
}: {
  value: Confirmation | null;
  close: () => void;
  busy: boolean;
}) {
  return (
    <AlertDialog
      open={!!value}
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{value?.title}</AlertDialogTitle>
          <AlertDialogDescription>{value?.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            className="destructive-button"
            disabled={busy}
            onClick={async (e) => {
              e.preventDefault();
              await value?.action();
              close();
            }}
          >
            {busy ? <Loader2 className="animate-spin" /> : <Trash2 />}Eliminar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
export function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}
function Submit({
  busy,
  children = "Guardar cambios",
}: {
  busy: boolean;
  children?: ReactNode;
}) {
  return (
    <Button type="submit" disabled={busy}>
      {busy ? <Loader2 className="animate-spin" /> : <Check size={16} />}
      {children}
    </Button>
  );
}
export function Colors({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const selectedColor = value.toLowerCase();
  const customSelected = !COLORS.includes(selectedColor);

  return (
    <div className="project-color-picker">
      <div
        className="color-choices"
        role="group"
        aria-label="Colores predeterminados"
      >
        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`Color ${c}`}
            aria-pressed={c === selectedColor}
            title={c.toUpperCase()}
            disabled={disabled}
            className="color-choice"
            style={{ background: c }}
            onClick={() => onChange(c)}
          >
            {selectedColor === c && <Check size={16} />}
          </button>
        ))}
      </div>
      <label className="custom-color-choice" data-selected={customSelected}>
        <input
          type="color"
          aria-label="Color personalizado"
          value={selectedColor}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
        />
        <span>Personalizado</span>
        {customSelected && <Check size={14} aria-hidden="true" />}
        <span className="custom-color-value">{value.toUpperCase()}</span>
      </label>
    </div>
  );
}

export function WorkspaceModal({
  modal,
  close,
  project,
  workspace,
  mutate,
  busy,
  confirm,
  selectProject,
}: {
  modal: Modal;
  close: () => void;
  project?: Project;
  workspace: Workspace;
  mutate: Mutate;
  busy: boolean;
  confirm: (c: Confirmation) => void;
  selectProject: (id: string) => void;
}) {
  const title =
    modal.type === "project"
      ? modal.project
        ? "Editar proyecto"
        : "Un nuevo comienzo"
      : modal.type === "feature"
        ? modal.feature
          ? "Editar feature"
          : "Nueva feature"
        : modal.type === "module"
          ? modal.module
            ? "Editar módulo"
            : "Nuevo módulo"
          : modal.type === "task"
            ? "Nueva tarea"
            : "Trae tus tareas de Trello";
  const desc =
    modal.type === "project"
      ? "Dale un nombre y un lugar a tu próxima idea."
      : modal.type === "feature"
        ? "Agrupa tareas que contribuyen al mismo objetivo."
        : modal.type === "module"
          ? "Organiza las features de tu proyecto en un módulo."
          : modal.type === "task"
            ? "Define el siguiente paso de tu proyecto."
            : "Importa un tablero a partir de su archivo JSON.";
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
    >
      <DialogContent
        className={
          modal.type === "task"
            ? "task-create-dialog"
            : modal.type === "project"
              ? "project-dialog"
              : undefined
        }
        onInteractOutside={(e) => {
          if (busy) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{desc}</DialogDescription>
        </DialogHeader>
        {modal.type === "project" && (
          <ProjectForm
            project={modal.project}
            projects={workspace.projects}
            mutate={mutate}
            busy={busy}
            close={close}
            confirm={confirm}
            selectProject={selectProject}
          />
        )}
        {modal.type === "feature" && project && (
          <FeatureForm
            feature={modal.feature}
            defaultModuleId={modal.moduleId}
            projectId={project.id}
            people={(workspace.people ?? []).filter(
              (p) => p.projectId === project.id,
            )}
            canReorder={
              workspace.currentUser.role === "admin" ||
              project.leaderId === workspace.currentUser.id
            }
            features={workspace.features.filter(
              (feature) => feature.projectId === project.id,
            )}
            modules={workspace.modules.filter(
              (module) => module.projectId === project.id,
            )}
            mutate={mutate}
            busy={busy}
            close={close}
            confirm={confirm}
          />
        )}
        {modal.type === "module" && project && (
          <ModuleForm
            module={modal.module}
            projectId={project.id}
            people={(workspace.people ?? []).filter(
              (p) => p.projectId === project.id,
            )}
            canReorder={
              workspace.currentUser.role === "admin" ||
              project.leaderId === workspace.currentUser.id
            }
            modules={workspace.modules.filter(
              (module) => module.projectId === project.id,
            )}
            mutate={mutate}
            busy={busy}
            close={close}
            confirm={confirm}
          />
        )}
        {modal.type === "import" && (
          <ImportForm
            project={
              project &&
              (workspace.currentUser.role === "admin" ||
                project.leaderId === workspace.currentUser.id)
                ? project
                : undefined
            }
            mutate={mutate}
            busy={busy}
            close={close}
            selectProject={selectProject}
          />
        )}
        {modal.type === "task" && project && (
          <TaskCreateForm
            project={project}
            workspace={workspace}
            defaults={modal.defaults}
            mutate={mutate}
            busy={busy}
            close={close}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function TaskCreateForm({
  project,
  workspace,
  defaults = {},
  mutate,
  busy,
  close,
}: {
  project: Project;
  workspace: Workspace;
  defaults?: TaskDefaults;
  mutate: Mutate;
  busy: boolean;
  close: () => void;
}) {
  const [leaderId, setLeaderId] = useState(workspace.currentUser.id);
  const [teamMemberIds, setTeamMemberIds] = useState<string[]>([]);
  const [uploading, setUploading] = useState(0);
  const people = (workspace.people ?? []).filter(
    (p) => p.projectId === project.id,
  );
  const mayKeepAccess = () =>
    leaderId === workspace.currentUser.id ||
    teamMemberIds.includes(workspace.currentUser.id) ||
    workspace.currentUser.role === "admin" ||
    project.leaderId === workspace.currentUser.id ||
    features.some(
      (f) =>
        f.id === featureId &&
        (f.leaderId === workspace.currentUser.id ||
          workspace.modules.some(
            (m) =>
              m.id === f.moduleId && m.leaderId === workspace.currentUser.id,
          )),
    );
  const router = useWorkspaceRouter();
  const view = getProjectView(useSearchParams().get("view"));
  const features = workspace.features.filter(
    (feature) => feature.projectId === project.id,
  );
  const statuses = workspace.statuses.filter(
    (status) => status.projectId === project.id,
  );
  const priorities = workspace.priorities.filter(
    (priority) => priority.projectId === project.id,
  );
  const [statusId, setStatusId] = useState(
    statuses.some((status) => status.id === defaults.statusId)
      ? defaults.statusId!
      : (statuses[0]?.id ?? ""),
  );
  const [priority, setPriority] = useState(
    priorities.find((option) => option.id === "medium")?.id ??
      priorities[0]?.id ??
      "",
  );
  const [typeId, setTypeId] = useState(
    (workspace.taskTypes ?? []).some(
      (option) =>
        option.projectId === project.id && option.id === defaults.typeId,
    )
      ? defaults.typeId!
      : "",
  );
  const [impactId, setImpactId] = useState("");
  const [clientIds, setClientIds] = useState<string[]>([]);
  const [startDate, setStartDate] = useState(defaults.startDate ?? "");
  const [description, setDescription] = useState("");
  const [descriptionEditing, setDescriptionEditing] = useState(false);
  const [dueDate, setDueDate] = useState(defaults.dueDate ?? "");
  const [startTime, setStartTime] = useState(defaults.startTime ?? "");
  const [dueTime, setDueTime] = useState(defaults.dueTime ?? "");
  const [featureId, setFeatureId] = useState(
    features.some((feature) => feature.id === defaults.featureId)
      ? defaults.featureId!
      : (features[0]?.id ?? ""),
  );
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (uploading) return;
    const afterCreate = (
      (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null
    )?.value;
    const data = new FormData(event.currentTarget);
    const result = await mutate({
      type: "task.create",
      leaderId,
      teamMemberIds,
      projectId: project.id,
      title: data.get("title"),
      description,
      featureId: data.get("featureId"),
      statusId: data.get("statusId"),
      priority: data.get("priority"),
      typeId: data.get("typeId") || null,
      impactId: data.get("impactId") || null,
      ticketNumber: String(data.get("ticketNumber") ?? "").trim() || null,
      startDate: startDate || null,
      startTime: startDate ? startTime || null : null,
      dueDate: dueDate || null,
      dueTime: dueDate ? dueTime || null : null,
      labels: [],
      clientIds,
    });
    if (!result) return;
    close();
    toast.success("Tarea creada.");
    if (afterCreate === "edit" && result.createdId && mayKeepAccess()) {
      const source = /\/(?:details|modules\/[^/]+|features\/[^/]+)$/.test(
        window.location.pathname,
      )
        ? safeReturnTo(
            project.id,
            `${window.location.pathname}${window.location.search}`,
          )
        : null;
      router.push(
        source
          ? entityPath(
              project.id,
              "task",
              result.createdId,
              view,
              undefined,
              source,
            )
          : taskPath(project.id, result.createdId, view),
      );
    }
  }
  return (
    <form className="task-create-form" onSubmit={submit}>
      <div className="task-create-fields">
        <Field label="Título" htmlFor="create-task-title">
          <Input
            id="create-task-title"
            name="title"
            placeholder="¿Qué hay que hacer?"
            required
            maxLength={300}
            autoFocus
          />
        </Field>
        <div className="task-create-description">
          <span className="task-create-description-label">Descripción</span>
          <DescriptionEditor
            value={description}
            onChange={setDescription}
            editing={descriptionEditing}
            setEditing={setDescriptionEditing}
            disabled={busy}
            uploadImage={async (file) =>
              (await uploadFile(file, project.id, undefined, "image")).url
            }
            onUploadingChange={setUploading}
          />
        </div>
        <TaskPeopleFields
          idPrefix="create-task"
          people={people}
          leaderId={leaderId}
          teamMemberIds={teamMemberIds}
          onLeader={setLeaderId}
          onTeamMembers={setTeamMemberIds}
          disabled={busy}
        />
        <section className="task-property-section" aria-label="Propiedades">
          <h2>Propiedades</h2>
          <div className="task-properties-grid">
            <Field label="Feature" htmlFor="create-task-feature">
              <FeatureCombobox
                id="create-task-feature"
                name="featureId"
                features={features}
                modules={workspace.modules.filter(
                  (module) => module.projectId === project.id,
                )}
                value={featureId}
                onChange={setFeatureId}
                disabled={busy}
              />
            </Field>
            <Field label="Estado" htmlFor="create-task-status">
              <CatalogCombobox
                id="create-task-status"
                name="statusId"
                label="Estado"
                options={statuses}
                value={statusId}
                onChange={setStatusId}
                disabled={busy}
              />
            </Field>
            <Field label="Prioridad" htmlFor="create-task-priority">
              <CatalogCombobox
                id="create-task-priority"
                name="priority"
                label="Prioridad"
                options={priorities}
                value={priority}
                onChange={setPriority}
                disabled={busy}
              />
            </Field>
            {(
              [
                {
                  field: "typeId",
                  label: "Tipo",
                  empty: "Sin tipo",
                  options: workspace.taskTypes ?? [],
                  value: typeId,
                  setValue: setTypeId,
                },
                {
                  field: "impactId",
                  label: "Impacto",
                  empty: "Sin impacto",
                  options: workspace.impacts ?? [],
                  value: impactId,
                  setValue: setImpactId,
                },
              ] as const
            ).map(({ field, label, empty, options, value, setValue }) => (
              <Field
                key={field}
                label={`${label} (opcional)`}
                htmlFor={`create-task-${field}`}
              >
                <CatalogCombobox
                  id={`create-task-${field}`}
                  name={field}
                  label={label}
                  options={options.filter(
                    (option) => option.projectId === project.id,
                  )}
                  emptyLabel={empty}
                  value={value}
                  onChange={setValue}
                  disabled={busy}
                />
              </Field>
            ))}
            <Field label="Ticket (opcional)" htmlFor="create-task-ticket">
              <Input
                id="create-task-ticket"
                name="ticketNumber"
                placeholder="Ej. 001234"
                maxLength={100}
                disabled={busy}
              />
            </Field>
            <div className="task-schedule-group">
              <span>
                Inicio <small>opcional</small>
              </span>
              <div>
                <Input
                  type="date"
                  aria-label="Fecha de inicio (opcional)"
                  min="1900-01-01"
                  max={dueDate || "9999-12-31"}
                  value={startDate}
                  onChange={(e) => {
                    setStartDate(e.target.value);
                    if (!e.target.value) setStartTime("");
                  }}
                />
                <Input
                  type="time"
                  aria-label="Hora de inicio (opcional)"
                  disabled={!startDate}
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                />
              </div>
            </div>
            <div className="task-schedule-group">
              <span>
                Entrega <small>opcional</small>
              </span>
              <div>
                <Input
                  type="date"
                  aria-label="Fecha de entrega"
                  min={startDate || "1900-01-01"}
                  max="9999-12-31"
                  value={dueDate}
                  onChange={(e) => {
                    setDueDate(e.target.value);
                    if (!e.target.value) setDueTime("");
                  }}
                />
                <Input
                  type="time"
                  aria-label="Hora de entrega (opcional)"
                  disabled={!dueDate}
                  value={dueTime}
                  onChange={(e) => setDueTime(e.target.value)}
                />
              </div>
            </div>
          </div>
        </section>
        <section className="task-property-section" aria-label="Clientes">
          <h2>
            Clientes <small>Opcional</small>
          </h2>
          <ClientPicker
            id="create-task-clients"
            clients={workspace.clients ?? []}
            values={clientIds}
            onChange={setClientIds}
            mutate={mutate}
            busy={busy}
          />
        </section>
      </div>
      <div className="task-create-actions">
        <Button type="button" variant="ghost" disabled={busy} onClick={close}>
          Cancelar
        </Button>
        <Button
          type="submit"
          name="afterCreate"
          value="close"
          disabled={busy || uploading > 0}
        >
          {busy ? <Loader2 className="animate-spin" /> : <Plus size={16} />}
          Crear
        </Button>
        <Button
          type="submit"
          name="afterCreate"
          value="edit"
          variant="outline"
          disabled={busy}
        >
          Crear y editar
        </Button>
      </div>
    </form>
  );
}
function ProjectForm({
  project,
  projects,
  mutate,
  busy,
  close,
  confirm,
  selectProject,
}: {
  project?: Project;
  projects: Project[];
  mutate: Mutate;
  busy: boolean;
  close: () => void;
  confirm: (c: Confirmation) => void;
  selectProject: (id: string) => void;
}) {
  const [color, setColor] = useState(project?.color ?? COLORS[0]);
  const [icon, setIcon] = useState(project?.icon ?? "");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const result = await mutate({
      type: project ? "project.update" : "project.create",
      id: project?.id,
      name: data.get("name"),
      description: data.get("description"),
      icon: icon || "🌱",
      color,
    });
    if (result) {
      if (result.createdId) selectProject(result.createdId);
      close();
    }
  }
  return (
    <form onSubmit={submit} className="form-stack">
      <Field label="Icono del proyecto" htmlFor="project-icon">
        <EmojiPicker
          id="project-icon"
          value={icon}
          onChange={setIcon}
          emojis={projects.map((item) => item.icon)}
          disabled={busy}
        />
      </Field>
      <Field label="Nombre del proyecto" htmlFor="project-name">
        <Input
          id="project-name"
          name="name"
          defaultValue={project?.name}
          required
          maxLength={160}
          placeholder="Por ejemplo, Rediseño de mi web"
          autoFocus
        />
      </Field>
      <Field label="Descripción" htmlFor="project-description">
        <Textarea
          id="project-description"
          name="description"
          maxLength={30000}
          defaultValue={project?.description}
          placeholder="¿Qué quieres conseguir?"
          rows={3}
        />
      </Field>
      <div className="field">
        <Label>Color del proyecto</Label>
        <Colors value={color} onChange={setColor} disabled={busy} />
      </div>
      <div className="dialog-actions">
        {project && (
          <Button
            type="button"
            variant="ghost"
            className="danger"
            disabled={busy}
            onClick={() =>
              confirm({
                title: "¿Eliminar este proyecto?",
                description: `Se eliminarán «${project.name}», sus features y todas sus tareas, incluidas las archivadas. Esta acción es permanente.`,
                action: async () => {
                  if (await mutate({ type: "project.delete", id: project.id }))
                    close();
                },
              })
            }
          >
            <Trash2 />
            Eliminar proyecto
          </Button>
        )}
        <Submit busy={busy}>
          {project ? "Guardar cambios" : "Crear proyecto"}
        </Submit>
      </div>
    </form>
  );
}
function FeatureForm({
  feature,
  defaultModuleId,
  projectId,
  people,
  canReorder,
  features,
  modules,
  mutate,
  busy,
  close,
  confirm,
}: {
  feature?: Feature;
  defaultModuleId?: string | null;
  projectId: string;
  people: UserSummary[];
  canReorder: boolean;
  features: Feature[];
  modules: ProjectModule[];
  mutate: Mutate;
  busy: boolean;
  close: () => void;
  confirm: (c: Confirmation) => void;
}) {
  const index = features.findIndex((item) => item.id === feature?.id);
  const group = features.filter((item) => item.moduleId === feature?.moduleId);
  const groupIndex = group.findIndex((item) => item.id === feature?.id);

  async function reorder(offset: number) {
    const target = group[groupIndex + offset];
    if (busy || index < 0 || !target) return;
    const ids = features.map((item) => item.id);
    const targetIndex = features.findIndex((item) => item.id === target.id);
    [ids[index], ids[targetIndex]] = [ids[targetIndex], ids[index]];
    await mutate({ type: "feature.reorder", projectId, ids });
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    if (
      await mutate({
        type: feature ? "feature.update" : "feature.create",
        id: feature?.id,
        projectId,
        moduleId:
          data.get("moduleId") === "general" ? null : data.get("moduleId"),
        name: data.get("name"),
        description: data.get("description"),
      })
    )
      close();
  }
  return (
    <form onSubmit={submit} className="form-stack">
      <fieldset
        className="scope-fields"
        disabled={busy || feature?.canManage === false}
      >
        <Field label="Nombre de la feature" htmlFor="feature-name">
          <Input
            id="feature-name"
            name="name"
            defaultValue={feature?.name}
            placeholder="Por ejemplo, Experiencia de compra"
            required
            maxLength={160}
            autoFocus
          />
        </Field>
        <Field label="Descripción" htmlFor="feature-description">
          <Textarea
            id="feature-description"
            name="description"
            defaultValue={feature?.description}
            placeholder="El objetivo de esta parte del proyecto"
            maxLength={30000}
          />
        </Field>
        <Field label="Módulo" htmlFor="feature-module">
          <select
            id="feature-module"
            name="moduleId"
            defaultValue={
              feature
                ? (feature.moduleId ?? "general")
                : defaultModuleId === undefined
                  ? ""
                  : (defaultModuleId ?? "general")
            }
            required
            disabled={busy}
          >
            <option value="" disabled>
              Selecciona un módulo
            </option>
            <option value="general">00 · General (sin módulo)</option>
            {modules.map((module, index) => (
              <option key={module.id} value={module.id}>
                {String(index + 1).padStart(2, "0")} · {module.name}
              </option>
            ))}
          </select>
        </Field>
        {feature && (
          <div className="feature-order">
            <span>
              Número de la feature{" "}
              <strong>{formatFeatureNumber(feature.number)}</strong>
            </span>
            <Button
              type="button"
              variant="outline"
              size="icon"
              disabled={busy || !canReorder || groupIndex <= 0}
              aria-label="Mover feature hacia arriba"
              onClick={() => reorder(-1)}
            >
              <ArrowUp size={15} />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              disabled={
                busy ||
                !canReorder ||
                groupIndex < 0 ||
                groupIndex >= group.length - 1
              }
              aria-label="Mover feature hacia abajo"
              onClick={() => reorder(1)}
            >
              <ArrowDown size={15} />
            </Button>
          </div>
        )}
        {feature && (
          <EntityAssignments
            leaderId={feature.leaderId ?? ""}
            teamMemberIds={feature.teamMemberIds ?? []}
            people={people.map((person) => ({
              ...person,
              projectId,
              email: "",
            }))}
            canManage={feature.canManage !== false}
            busy={busy}
            onSave={async (leaderId, teamMemberIds) =>
              !!(await mutate({
                type: "feature.assignment.update",
                id: feature.id,
                leaderId,
                teamMemberIds,
              }))
            }
          />
        )}
        <div className="dialog-actions">
          {feature && (
            <Button
              variant="ghost"
              type="button"
              className="danger"
              disabled={busy}
              onClick={() =>
                confirm({
                  title: "¿Eliminar esta feature?",
                  description: `Se eliminarán «${feature.name}» y todas sus tareas, incluidas las archivadas. Esta acción es permanente.`,
                  action: async () => {
                    if (
                      await mutate({ type: "feature.delete", id: feature.id })
                    )
                      close();
                  },
                })
              }
            >
              <Trash2 />
              Eliminar
            </Button>
          )}
          <Submit busy={busy}>
            {feature ? "Guardar cambios" : "Crear feature"}
          </Submit>
        </div>
      </fieldset>
    </form>
  );
}
function ModuleForm({
  module,
  projectId,
  people,
  canReorder,
  modules,
  mutate,
  busy,
  close,
  confirm,
}: {
  module?: ProjectModule;
  projectId: string;
  people: UserSummary[];
  canReorder: boolean;
  modules: ProjectModule[];
  mutate: Mutate;
  busy: boolean;
  close: () => void;
  confirm: (c: Confirmation) => void;
}) {
  const index = modules.findIndex((item) => item.id === module?.id);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (
      await mutate({
        type: module ? "module.update" : "module.create",
        id: module?.id,
        projectId,
        name: data.get("name"),
        description: data.get("description"),
      })
    )
      close();
  }
  async function reorder(offset: number) {
    const ids = modules.map((item) => item.id);
    [ids[index], ids[index + offset]] = [ids[index + offset], ids[index]];
    await mutate({ type: "module.reorder", projectId, ids });
  }
  return (
    <form onSubmit={submit} className="form-stack">
      <fieldset
        className="scope-fields"
        disabled={busy || module?.canManage === false}
      >
        <Field label="Nombre del módulo" htmlFor="module-name">
          <Input
            id="module-name"
            name="name"
            defaultValue={module?.name}
            placeholder="Por ejemplo, Administración"
            required
            maxLength={160}
            autoFocus
          />
        </Field>
        <Field label="Descripción" htmlFor="module-description">
          <Textarea
            id="module-description"
            name="description"
            defaultValue={module?.description}
            placeholder="Qué reúne este módulo del proyecto"
            maxLength={30000}
          />
        </Field>
        {module && (
          <div className="module-order">
            <span>
              Orden del módulo{" "}
              <strong>{String(index + 1).padStart(2, "0")}</strong>
            </span>
            <Button
              type="button"
              variant="outline"
              size="icon"
              disabled={busy || !canReorder || index <= 0}
              aria-label="Mover módulo hacia arriba"
              onClick={() => reorder(-1)}
            >
              <ArrowUp size={15} />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              disabled={busy || !canReorder || index >= modules.length - 1}
              aria-label="Mover módulo hacia abajo"
              onClick={() => reorder(1)}
            >
              <ArrowDown size={15} />
            </Button>
          </div>
        )}
        {module && (
          <EntityAssignments
            leaderId={module.leaderId ?? ""}
            teamMemberIds={module.teamMemberIds ?? []}
            people={people.map((person) => ({
              ...person,
              projectId,
              email: "",
            }))}
            canManage={module.canManage !== false}
            busy={busy}
            onSave={async (leaderId, teamMemberIds) =>
              !!(await mutate({
                type: "module.assignment.update",
                id: module.id,
                leaderId,
                teamMemberIds,
              }))
            }
          />
        )}
        <div className="dialog-actions">
          {module && (
            <Button
              variant="ghost"
              type="button"
              className="danger"
              disabled={busy}
              onClick={() =>
                confirm({
                  title: "¿Eliminar este módulo?",
                  description: `Se eliminará «${module.name}». Sus features pasarán a General y conservarán sus tareas.`,
                  action: async () => {
                    if (await mutate({ type: "module.delete", id: module.id }))
                      close();
                  },
                })
              }
            >
              <Trash2 />
              Eliminar
            </Button>
          )}
          <Submit busy={busy}>
            {module ? "Guardar cambios" : "Crear módulo"}
          </Submit>
        </div>
      </fieldset>
    </form>
  );
}
export function StatusesForm({
  statuses,
  projectId,
  mutate,
  busy,
}: {
  statuses: Status[];
  projectId: string;
  mutate: Mutate;
  busy: boolean;
}) {
  async function reorder(index: number, offset: number) {
    const ids = statuses.map((s) => s.id);
    [ids[index], ids[index + offset]] = [ids[index + offset], ids[index]];
    await mutate({ type: "status.reorder", projectId, ids });
  }
  return (
    <div className="form-stack settings-editor">
      <p className="info-note">
        Marca como finalizado un estado para identificar las tareas completadas
        en el tablero y la lista. Para eliminar un estado, primero mueve todas
        sus tareas.
      </p>
      <div
        className="status-editor"
        role="region"
        aria-label="Lista de estados"
        tabIndex={0}
      >
        {statuses.map((s, i) => (
          <StatusRow
            key={s.id}
            status={s}
            first={i === 0}
            last={i === statuses.length - 1}
            busy={busy}
            mutate={mutate}
            reorder={(offset) => reorder(i, offset)}
          />
        ))}
      </div>
      <StatusRow key="new" projectId={projectId} busy={busy} mutate={mutate} />
    </div>
  );
}
function StatusRow({
  status,
  projectId,
  busy,
  mutate,
  first,
  last,
  reorder,
}: {
  status?: Status;
  projectId?: string;
  busy: boolean;
  mutate: Mutate;
  first?: boolean;
  last?: boolean;
  reorder?: (offset: number) => void;
}) {
  const [name, setName] = useState(status?.name ?? "");
  const [color, setColor] = useState(status?.color ?? COLORS[0]);
  const [isDone, setDone] = useState(status?.isDone ?? false);
  const lastSubmitted = useRef({ name, color, isDone });
  async function save(done = isDone) {
    const values = { name: name.trim(), color, isDone: done };
    if (!values.name) {
      if (status) setName(status.name);
      toast.error("El nombre no puede estar vacío.");
      return;
    }
    if (
      status &&
      values.name === lastSubmitted.current.name &&
      values.color === lastSubmitted.current.color &&
      values.isDone === lastSubmitted.current.isDone
    ) {
      setName(values.name);
      return;
    }
    const previous = lastSubmitted.current;
    lastSubmitted.current = values;
    if (
      await mutate({
        type: status ? "status.update" : "status.create",
        id: status?.id,
        projectId,
        ...values,
      })
    ) {
      setName((current) =>
        current === name ? (status ? values.name : "") : current,
      );
      if (!status) {
        setDone(false);
      }
    } else if (lastSubmitted.current === values) {
      lastSubmitted.current = previous;
    }
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    void save();
  }
  return (
    <form onSubmit={submit} className="status-row">
      <div className="status-row-main">
        <input
          type="color"
          aria-label={
            status ? `Color de ${status.name}` : "Color del nuevo estado"
          }
          value={color}
          onChange={(e) => setColor(e.target.value)}
          onBlur={status ? () => void save() : undefined}
        />
        <Input
          aria-label={
            status ? `Nombre de ${status.name}` : "Nombre del nuevo estado"
          }
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={status ? () => void save() : undefined}
          placeholder="Nuevo estado"
          required
          maxLength={60}
        />
        {status && (
          <div className="order-buttons">
            <Button
              variant="ghost"
              size="icon"
              type="button"
              disabled={busy || first}
              onClick={() => reorder?.(-1)}
              aria-label={`Subir ${status.name}`}
            >
              <ArrowUp />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              type="button"
              disabled={busy || last}
              onClick={() => reorder?.(1)}
              aria-label={`Bajar ${status.name}`}
            >
              <ArrowDown />
            </Button>
          </div>
        )}
        {!status && (
          <Button
            size="icon"
            type="submit"
            disabled={busy}
            aria-label="Añadir estado"
          >
            <Plus />
          </Button>
        )}
        {status && (
          <Button
            variant="ghost"
            size="icon"
            type="button"
            className="danger"
            disabled={busy}
            aria-label={`Eliminar ${status.name}`}
            onClick={() => mutate({ type: "status.delete", id: status.id })}
          >
            <Trash2 />
          </Button>
        )}
      </div>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={isDone}
          onChange={(e) => {
            setDone(e.target.checked);
            if (status) void save(e.target.checked);
          }}
        />
        Cuenta como finalizado
      </label>
    </form>
  );
}
function ImportForm({
  project,
  mutate,
  busy,
  close,
  selectProject,
}: {
  project?: Project;
  mutate: Mutate;
  busy: boolean;
  close: () => void;
  selectProject: (id: string) => void;
}) {
  const [board, setBoard] = useState<TrelloBoard | null>(null);
  const [fileName, setFileName] = useState("");
  const [target, setTarget] = useState("new");
  const [error, setError] = useState("");
  async function read(file?: File) {
    setBoard(null);
    setError("");
    if (!file) return;
    setFileName(file.name);
    if (file.size > 12 * 1024 * 1024) {
      setError("El archivo supera los 12 MB.");
      return;
    }
    try {
      const result = trelloSchema.safeParse(JSON.parse(await file.text()));
      if (!result.success) {
        setError(
          "El archivo no es un tablero de Trello válido: " +
            result.error.issues[0].message,
        );
        return;
      }
      setBoard(result.data);
    } catch {
      setError(
        "No se pudo leer el archivo. Selecciona una exportación JSON de Trello.",
      );
    }
  }
  return (
    <div className="form-stack">
      <div className="import-steps">
        <span className="step-number">1</span>
        <p>
          En Trello, abre el menú de tu tablero →{" "}
          <strong>Imprimir y exportar → Exportar como JSON</strong>.
        </p>
      </div>
      <label className="file-drop" htmlFor="trello-file">
        <FileJson size={30} />
        <strong>{fileName || "Selecciona tu archivo JSON"}</strong>
        <span>Exportación de un tablero · Hasta 12 MB</span>
        <Input
          type="file"
          id="trello-file"
          accept=".json,application/json"
          onChange={(e) => read(e.target.files?.[0])}
          disabled={busy}
        />
      </label>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {board && (
        <div className="import-preview">
          <Check size={18} />
          <div>
            <strong>{board.name}</strong>
            <span>
              {board.lists.length} listas · {board.cards.length} tareas ·{" "}
              {
                board.cards.filter(
                  (c) =>
                    c.closed ||
                    board.lists.find((l) => l.id === c.idList)?.closed,
                ).length
              }{" "}
              archivadas
            </span>
          </div>
        </div>
      )}
      <Field label="Destino" htmlFor="import-target">
        <select
          id="import-target"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          disabled={busy}
        >
          <option value="new">Crear un proyecto nuevo</option>
          {project && (
            <option value="current">Proyecto actual: {project.name}</option>
          )}
        </select>
      </Field>
      <p className="form-meta">
        Las listas se convierten en estados y las tarjetas se agrupan en una
        feature. Se conservan título, descripción, fecha, etiquetas y archivo.
        Adjuntos, comentarios, miembros y checklists no se importan. Repetir la
        importación en el mismo proyecto omite las tarjetas existentes.
      </p>
      <div className="dialog-actions">
        <Button
          disabled={!board || busy}
          onClick={async () => {
            if (!board) return;
            const result = await mutate({
              type: "trello.import",
              board,
              projectId: target === "current" ? project?.id : null,
            });
            if (result?.report) {
              selectProject(result.report.projectId);
              toast.success(
                `${result.report.imported} tareas importadas · ${result.report.skipped} duplicadas omitidas`,
              );
              close();
            }
          }}
        >
          {busy ? <Loader2 className="animate-spin" /> : <Upload />}Importar
          tablero
        </Button>
      </div>
    </div>
  );
}
