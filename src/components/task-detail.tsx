"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckSquare,
  History,
  Send,
  Layers3,
  ListChecks,
  Loader2,
  MessageSquare,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Tabs } from "radix-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, type Confirmation, type Mutate } from "./forms";
import { useProjectCatalog } from "./project-catalog";
import { CatalogCombobox } from "./catalog-combobox";
import { InlineTaskTitle, TaskLabelPicker } from "./task-heading";
import { FeatureCombobox } from "./feature-combobox";
import { DescriptionEditor } from "./description-editor";
import { useUnsavedChanges } from "./unsaved-changes";
import { getProjectView, projectPath, taskPath } from "@/lib/routes";
import type {
  Checklist,
  ChecklistItem,
  Project,
  Task,
  TaskComment,
  Workspace,
} from "@/lib/types";

export type TaskDefaults = {
  featureId?: string;
  typeId?: string;
  statusId?: string;
  startDate?: string;
  startTime?: string;
  dueDate?: string;
  dueTime?: string;
};

function timestamp(value: string, withTime = false) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "America/Bogota",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(value))
      .map((part) => [part.type, part.value]),
  );
  return `${parts.day}/${parts.month}/${parts.year}${withTime ? ` · ${parts.hour}:${parts.minute}` : ""}`;
}

function AutoTextarea(props: React.ComponentProps<typeof Textarea>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const resize = () => {
      if (!ref.current) return;
      ref.current.style.height = "auto";
      ref.current.style.height = `${ref.current.scrollHeight + 2}px`;
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [props.value]);
  return (
    <Textarea
      {...props}
      ref={ref}
      className={`auto-textarea ${props.className ?? ""}`}
    />
  );
}

export function TaskDetail({
  task,
  project,
  workspace,
  defaults = {},
  mutate,
  busy,
  confirm,
  sidebarControls,
}: {
  task?: Task;
  project: Project;
  workspace: Workspace;
  defaults?: TaskDefaults;
  mutate: Mutate;
  busy: boolean;
  confirm: (value: Confirmation) => void;
  sidebarControls: ReactNode;
}) {
  const router = useRouter();
  const view = getProjectView(useSearchParams().get("view"));
  const { priorities, taskTypes, impacts } = useProjectCatalog();
  const features = workspace.features.filter(
    (feature) => feature.projectId === project.id,
  );
  const statuses = workspace.statuses.filter(
    (status) => status.projectId === project.id,
  );
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [labels, setLabels] = useState(task?.labels ?? []);
  const [featureId, setFeatureId] = useState(
    task?.featureId ??
      (features.some((feature) => feature.id === defaults.featureId)
        ? defaults.featureId!
        : (features[0]?.id ?? "")),
  );
  const [statusId, setStatusId] = useState(
    task?.statusId ??
      (statuses.some((status) => status.id === defaults.statusId)
        ? defaults.statusId!
        : (statuses[0]?.id ?? "")),
  );
  const [priority, setPriority] = useState(
    task?.priority ??
      priorities.find((item) => item.id === "medium")?.id ??
      priorities[0]?.id ??
      "",
  );
  const [typeId, setTypeId] = useState(
    task?.typeId ??
      (taskTypes.some((option) => option.id === defaults.typeId)
        ? defaults.typeId!
        : ""),
  );
  const [impactId, setImpactId] = useState(task?.impactId ?? "");
  const [ticketNumber, setTicketNumber] = useState(task?.ticketNumber ?? "");
  const [dueDate, setDueDate] = useState(
    task?.dueDate ?? defaults.dueDate ?? "",
  );
  const [dueTime, setDueTime] = useState(
    task?.dueTime ?? defaults.dueTime ?? "",
  );
  const [startDate, setStartDate] = useState(
    task?.startDate ?? defaults.startDate ?? "",
  );
  const [startTime, setStartTime] = useState(
    task?.startTime ?? defaults.startTime ?? "",
  );
  const [dirty, setDirty] = useState(false);
  const [descriptionEditing, setDescriptionEditing] = useState(false);
  const [descriptionContentHeight, setDescriptionContentHeight] = useState(0);
  const [activeTab, setActiveTab] = useState("properties");
  const [chatOpen, setChatOpen] = useState(false);
  const [mobileComments, setMobileComments] = useState(false);
  const [commentDraft, setCommentDraft] = useState("");
  const chatToggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 900px)");
    const update = () => {
      setMobileComments(media.matches);
      if (!media.matches) setChatOpen(false);
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const pending = task
    ? title !== task.title ||
      description !== task.description ||
      featureId !== task.featureId ||
      statusId !== task.statusId ||
      priority !== task.priority ||
      typeId !== (task.typeId ?? "") ||
      impactId !== (task.impactId ?? "") ||
      ticketNumber.trim() !== (task.ticketNumber ?? "") ||
      startDate !== (task.startDate ?? "") ||
      startTime !== (task.startTime ?? "") ||
      dueDate !== (task.dueDate ?? "") ||
      dueTime !== (task.dueTime ?? "") ||
      JSON.stringify(labels) !== JSON.stringify(task.labels)
    : dirty || !!title.trim() || !!description;
  const { requestNavigation, leaveDialog } = useUnsavedChanges(pending, busy);
  const previousLabels = useRef(task?.labels);
  useEffect(() => {
    if (
      task &&
      JSON.stringify(previousLabels.current) !== JSON.stringify(task.labels)
    ) {
      setLabels(task.labels);
      previousLabels.current = task.labels;
    }
  }, [task]);
  async function saveTitle(value: string) {
    const next = value.trim();
    if (!next) {
      setTitle(task?.title ?? "");
      if (task) toast.error("El título no puede estar vacío.");
      return;
    }
    setTitle(next);
    if (task && next !== task.title)
      await mutate({ type: "task.rename", id: task.id, title: next });
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim()) {
      toast.error("Escribe un título para la tarea.");
      document
        .querySelector<HTMLElement>('[aria-label="Título de la tarea"]')
        ?.focus();
      return;
    }
    const result = await mutate({
      type: task ? "task.update" : "task.create",
      id: task?.id,
      projectId: project.id,
      title: title.trim(),
      description,
      featureId,
      statusId,
      priority,
      typeId: typeId || null,
      impactId: impactId || null,
      ticketNumber: ticketNumber.trim() || null,
      startDate: startDate || null,
      startTime: startDate ? startTime || null : null,
      dueDate: dueDate || null,
      dueTime: dueDate ? dueTime || null : null,
      labels,
    });
    if (result) {
      setDirty(false);
      setDescriptionEditing(false);
      toast.success(task ? "Tarea guardada." : "Tarea creada.");
      if (!task && result.createdId)
        router.replace(taskPath(project.id, result.createdId, view));
    }
  }
  const commentContents = (
    <>
      <div className="section-heading chat-heading">
        <MessageSquare size={18} />
        {mobileComments ? (
          <DialogTitle>Comentarios</DialogTitle>
        ) : (
          <h2>Comentarios</h2>
        )}
        <span className="subtle-count">{task?.comments.length ?? 0}</span>
        {mobileComments && (
          <DialogClose asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Cerrar comentarios"
            >
              <X size={20} />
            </Button>
          </DialogClose>
        )}
      </div>
      {task ? (
        <Comments
          task={task}
          mutate={mutate}
          busy={busy}
          confirm={confirm}
          content={commentDraft}
          setContent={setCommentDraft}
        />
      ) : (
        <div className="comments-empty">
          <MessageSquare size={30} />
          <p>Crea la tarea para empezar la conversación.</p>
        </div>
      )}
    </>
  );
  return (
    <div className="task-detail-page">
      <header className="task-detail-header">
        <div className="task-header-navigation">
          {sidebarControls}
          <Button
            className="task-back-button"
            variant="ghost"
            disabled={busy}
            onClick={() =>
              requestNavigation(() =>
                router.push(projectPath(project.id, view)),
              )
            }
          >
            <ArrowLeft size={17} />
            {view === "list"
              ? "Volver a la lista"
              : view === "calendar"
                ? "Volver al calendario"
                : "Volver al tablero"}
          </Button>
        </div>
        <span title={project.name}>
          {project.icon} {project.name}
        </span>
        <div className="task-header-actions">
          <Button
            type="submit"
            form="task-detail-form"
            className="task-save-button"
            onMouseDown={(event) => event.preventDefault()}
            data-pending={pending}
            aria-label={task ? "Guardar cambios" : "Crear tarea"}
            title={
              pending
                ? "Hay cambios sin guardar"
                : "Todos los cambios guardados"
            }
            disabled={busy || !features.length}
          >
            {busy ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Check size={16} />
            )}
            <span>{task ? "Guardar cambios" : "Crear tarea"}</span>
            {pending && <i className="save-pending-dot" aria-hidden="true" />}
            <span className="sr-only" role="status">
              {busy
                ? "Guardando…"
                : pending
                  ? "Cambios sin guardar"
                  : "Todos los cambios guardados"}
            </span>
          </Button>
          <Button
            ref={chatToggle}
            type="button"
            variant="ghost"
            className="mobile-chat-toggle"
            aria-label="Abrir comentarios"
            aria-haspopup="dialog"
            aria-expanded={chatOpen}
            onClick={() => setChatOpen(true)}
          >
            <MessageSquare size={16} />
            Chat
            {!!task?.comments.length && <span>{task.comments.length}</span>}
          </Button>
          {task && (
            <>
              <Button
                variant="outline"
                disabled={busy}
                onClick={async () => {
                  if (
                    await mutate({
                      type: "task.archive",
                      id: task.id,
                      archived: !task.archived,
                    })
                  )
                    toast.success(
                      task.archived ? "Tarea restaurada." : "Tarea archivada.",
                    );
                }}
              >
                {task.archived ? "Restaurar" : "Archivar"}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="danger"
                aria-label="Eliminar tarea"
                disabled={busy}
                onClick={() =>
                  confirm({
                    title: "¿Eliminar esta tarea?",
                    description:
                      "Se eliminarán también su checklist, historial y comentarios. Esta acción es permanente.",
                    action: async () => {
                      if (await mutate({ type: "task.delete", id: task.id }))
                        router.push(projectPath(project.id, view));
                    },
                  })
                }
              >
                <Trash2 size={17} />
              </Button>
            </>
          )}
        </div>
      </header>
      <div className="task-detail-columns">
        <section className="task-detail-main">
          <div className="task-heading">
            <InlineTaskTitle
              value={title}
              change={setTitle}
              commit={saveTitle}
              busy={busy}
            />
          </div>
          <div className="task-labels-row">
            <TaskLabelPicker
              projectId={project.id}
              selected={labels}
              change={(value) => {
                setLabels(value);
                setDirty(true);
              }}
              mutate={mutate}
              busy={busy}
            />
          </div>
          {task?.archived && (
            <p className="info-note">
              Esta tarea está archivada. Puedes editarla o restaurarla.
            </p>
          )}
          <div className="task-edit-area">
            <div
              className="task-edit-panels"
              style={
                {
                  "--description-content-height": `${descriptionContentHeight}px`,
                } as CSSProperties
              }
            >
              <form
                id="task-detail-form"
                className="task-description-form"
                onSubmit={submit}
                onInvalidCapture={() => setActiveTab("properties")}
              >
                <DescriptionEditor
                  value={description}
                  onChange={(value) => {
                    setDescription(value);
                    setDirty(true);
                  }}
                  editing={descriptionEditing}
                  setEditing={setDescriptionEditing}
                  disabled={busy}
                  onContentHeightChange={setDescriptionContentHeight}
                />
              </form>
              <Tabs.Root
                value={activeTab}
                onValueChange={setActiveTab}
                className="task-detail-tabs"
              >
                <Tabs.List
                  className="task-section-tabs"
                  aria-label="Secciones de la tarea"
                >
                  <Tabs.Trigger value="properties" type="button">
                    <Layers3 size={16} />
                    Propiedades
                  </Tabs.Trigger>
                  <Tabs.Trigger value="checklists" type="button">
                    <ListChecks size={17} />
                    Checklist
                    {!!task?.checklists[0]?.items.length && (
                      <span>{task.checklists[0].items.length}</span>
                    )}
                  </Tabs.Trigger>
                  <Tabs.Trigger value="history" type="button">
                    <History size={16} />
                    Historial
                    {!!task?.statusHistory?.length && (
                      <span>{task.statusHistory.length}</span>
                    )}
                  </Tabs.Trigger>
                </Tabs.List>
                <Tabs.Content
                  value="properties"
                  forceMount
                  hidden={activeTab !== "properties"}
                  className="task-properties task-tab-panel"
                >
                  <div className="task-properties-grid">
                    <Field label="Feature" htmlFor="task-feature">
                      <FeatureCombobox
                        id="task-feature"
                        name="featureId"
                        form="task-detail-form"
                        features={features}
                        modules={workspace.modules.filter(
                          (module) => module.projectId === project.id,
                        )}
                        value={featureId}
                        onChange={(value) => {
                          setFeatureId(value);
                          setDirty(true);
                        }}
                        disabled={busy}
                      />
                    </Field>
                    <Field label="Estado" htmlFor="task-status">
                      <CatalogCombobox
                        id="task-status"
                        name="statusId"
                        form="task-detail-form"
                        label="Estado"
                        options={statuses}
                        value={statusId}
                        disabled={busy}
                        onChange={(value) => {
                          setStatusId(value);
                          setDirty(true);
                        }}
                      />
                    </Field>
                    <Field label="Prioridad" htmlFor="task-priority">
                      <CatalogCombobox
                        id="task-priority"
                        name="priority"
                        form="task-detail-form"
                        label="Prioridad"
                        options={priorities}
                        value={priority}
                        disabled={busy}
                        onChange={(value) => {
                          setPriority(value);
                          setDirty(true);
                        }}
                      />
                    </Field>
                    {(
                      [
                        {
                          field: "typeId",
                          label: "Tipo",
                          empty: "Sin tipo",
                          options: taskTypes,
                          value: typeId,
                          setValue: setTypeId,
                        },
                        {
                          field: "impactId",
                          label: "Impacto",
                          empty: "Sin impacto",
                          options: impacts,
                          value: impactId,
                          setValue: setImpactId,
                        },
                      ] as const
                    ).map(
                      ({ field, label, empty, options, value, setValue }) => (
                        <Field
                          key={field}
                          label={`${label} (opcional)`}
                          htmlFor={`task-${field}`}
                        >
                          <CatalogCombobox
                            id={`task-${field}`}
                            name={field}
                            form="task-detail-form"
                            label={label}
                            options={options}
                            emptyLabel={empty}
                            value={value}
                            disabled={busy}
                            onChange={(value) => {
                              setValue(value);
                              setDirty(true);
                            }}
                          />
                        </Field>
                      ),
                    )}
                    <Field
                      label="Ticket (opcional)"
                      htmlFor="task-ticket"
                    >
                      <Input
                        id="task-ticket"
                        name="ticketNumber"
                        form="task-detail-form"
                        placeholder="Ej. 001234"
                        maxLength={100}
                        value={ticketNumber}
                        disabled={busy}
                        onChange={(event) => {
                          setTicketNumber(event.target.value);
                          setDirty(true);
                        }}
                      />
                    </Field>
                    <div className="task-schedule-group">
                      <span>
                        Inicio <small>opcional</small>
                      </span>
                      <div>
                        <Input
                          type="date"
                          form="task-detail-form"
                          aria-label="Fecha de inicio (opcional)"
                          min="1900-01-01"
                          max={dueDate || "9999-12-31"}
                          value={startDate}
                          onChange={(e) => {
                            setStartDate(e.target.value);
                            if (!e.target.value) setStartTime("");
                            setDirty(true);
                          }}
                        />
                        <Input
                          type="time"
                          form="task-detail-form"
                          aria-label="Hora de inicio (opcional)"
                          value={startTime}
                          disabled={!startDate}
                          onChange={(e) => {
                            setStartTime(e.target.value);
                            setDirty(true);
                          }}
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
                          form="task-detail-form"
                          aria-label="Fecha de entrega"
                          min={startDate || "1900-01-01"}
                          max="9999-12-31"
                          value={dueDate}
                          onChange={(e) => {
                            setDueDate(e.target.value);
                            if (!e.target.value) setDueTime("");
                            setDirty(true);
                          }}
                        />
                        <Input
                          type="time"
                          form="task-detail-form"
                          aria-label="Hora de entrega (opcional)"
                          value={dueTime}
                          disabled={!dueDate}
                          onChange={(e) => {
                            setDueTime(e.target.value);
                            setDirty(true);
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </Tabs.Content>
                <Tabs.Content
                  value="checklists"
                  forceMount
                  hidden={activeTab !== "checklists"}
                  className="task-tab-panel checklist-tab-panel"
                >
                  {task ? (
                    <TaskChecklists
                      task={task}
                      mutate={mutate}
                      busy={busy}
                      confirm={confirm}
                    />
                  ) : (
                    <p className="info-note">
                      Crea la tarea para añadir su checklist.
                    </p>
                  )}
                </Tabs.Content>
                <Tabs.Content
                  value="history"
                  forceMount
                  hidden={activeTab !== "history"}
                  className="task-tab-panel task-history-panel"
                >
                  {task && (
                    <p className="task-updated-at">
                      Actualizada el{" "}
                      <time dateTime={task.updatedAt}>
                        {timestamp(task.updatedAt, true)}
                      </time>
                    </p>
                  )}
                  {task?.statusHistory?.length ? (
                    <ol
                      className="task-status-history"
                      aria-label="Historial de cambios de estado"
                    >
                      {task.statusHistory.map((change) => (
                        <li key={change.id}>
                          <time dateTime={change.changedAt}>
                            {timestamp(change.changedAt, true)}
                          </time>
                          <div>
                            <span className="history-status">
                              <i
                                style={{ background: change.fromStatusColor }}
                              />
                              {change.fromStatusName}
                            </span>
                            <ArrowRight size={14} aria-label="cambió a" />
                            <span className="history-status">
                              <i style={{ background: change.toStatusColor }} />
                              {change.toStatusName}
                            </span>
                          </div>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="info-note">
                      {task
                        ? "Todavía no hay cambios de estado registrados."
                        : "Crea la tarea para registrar su historial de estados."}
                    </p>
                  )}
                </Tabs.Content>
              </Tabs.Root>
            </div>
          </div>
        </section>
        {!mobileComments && (
          <aside className="task-comments" aria-label="Comentarios de la tarea">
            {commentContents}
          </aside>
        )}
      </div>
      <Dialog open={mobileComments && chatOpen} onOpenChange={setChatOpen}>
        <DialogContent
          className="task-comments task-comments-dialog translate-x-0 translate-y-0"
          showCloseButton={false}
          aria-modal="true"
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (chatToggle.current?.getClientRects().length)
              chatToggle.current.focus();
          }}
        >
          {commentContents}
        </DialogContent>
      </Dialog>
      {leaveDialog}
    </div>
  );
}

function TaskChecklists({
  task,
  mutate,
  busy,
  confirm,
}: {
  task: Task;
  mutate: Mutate;
  busy: boolean;
  confirm: (value: Confirmation) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const list = task.checklists[0];
  if (list)
    return (
      <section className="task-checklists" aria-label="Checklist de la tarea">
        <ChecklistSection
          key={list.id}
          list={list}
          mutate={mutate}
          busy={busy}
          confirm={confirm}
        />
      </section>
    );
  return (
    <section className="task-checklists">
      <div className="section-heading">
        <ListChecks size={19} />
        <h2>Checklist</h2>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => setAdding(!adding)}
        >
          <Plus size={14} />
          Crear checklist
        </Button>
      </div>
      {adding && (
        <form
          className="inline-add-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await mutate({ type: "checklist.create", taskId: task.id, title })
            ) {
              setTitle("");
              setAdding(false);
            }
          }}
        >
          <Input
            aria-label="Nombre de la checklist"
            placeholder="Por ejemplo: Antes de publicar"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            maxLength={160}
            autoFocus
          />
          <Button type="submit" disabled={busy}>
            Añadir
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Cancelar checklist"
            onClick={() => setAdding(false)}
          >
            <X />
          </Button>
        </form>
      )}
      {!task.checklists.length && !adding && (
        <div className="checklist-empty">
          <CheckSquare size={25} />
          <p>Divide el trabajo en pasos más pequeños.</p>
        </div>
      )}
    </section>
  );
}

function ChecklistSection({
  list,
  mutate,
  busy,
  confirm,
}: {
  list: Checklist;
  mutate: Mutate;
  busy: boolean;
  confirm: (value: Confirmation) => void;
}) {
  const [title, setTitle] = useState(list.title);
  const [editing, setEditing] = useState(false);
  const [itemTitle, setItemTitle] = useState("");
  const [addingItem, setAddingItem] = useState(false);
  const itemInput = useRef<HTMLInputElement>(null);
  const addItemButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (addingItem) itemInput.current?.focus();
  }, [addingItem]);
  const completed = list.items.filter((item) => item.completed).length;
  const progress = list.items.length
    ? Math.round((completed / list.items.length) * 100)
    : 0;
  return (
    <div className="checklist-section">
      <div className="checklist-heading">
        {editing ? (
          <form
            className="inline-add-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await mutate({ type: "checklist.update", id: list.id, title })
              )
                setEditing(false);
            }}
          >
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              aria-label="Renombrar checklist"
              required
              maxLength={160}
              autoFocus
            />
            <Button
              type="submit"
              size="icon"
              disabled={busy}
              aria-label="Guardar nombre de checklist"
            >
              <Check />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Cancelar nombre de checklist"
              onClick={() => {
                setTitle(list.title);
                setEditing(false);
              }}
            >
              <X />
            </Button>
          </form>
        ) : (
          <>
            <h3>{list.title}</h3>
            <Button
              variant="ghost"
              size="icon"
              disabled={busy}
              aria-label={`Renombrar ${list.title}`}
              onClick={() => setEditing(true)}
            >
              <Pencil size={14} />
            </Button>
          </>
        )}
        <span className="field-hint">
          {completed}/{list.items.length}
        </span>
        <Button
          ref={addItemButton}
          type="button"
          variant="ghost"
          size="icon"
          disabled={busy}
          aria-label={`Agregar ítem a ${list.title}`}
          title="Agregar ítem"
          aria-expanded={addingItem}
          onClick={() => {
            setAddingItem(true);
            itemInput.current?.focus();
          }}
        >
          <Plus size={15} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="danger"
          disabled={busy}
          aria-label={`Eliminar checklist ${list.title}`}
          onClick={() =>
            confirm({
              title: `¿Eliminar «${list.title}»?`,
              description: "Se eliminarán también todos sus elementos.",
              action: () => mutate({ type: "checklist.delete", id: list.id }),
            })
          }
        >
          <Trash2 size={14} />
        </Button>
      </div>
      <div className="checklist-progress">
        <span>{progress}%</span>
        <progress
          value={progress}
          max={100}
          aria-label={`Progreso de ${list.title}`}
        />
      </div>
      <div
        className="checklist-items"
        role="region"
        aria-label="Elementos del checklist"
        tabIndex={0}
      >
        {list.items.map((item) => (
          <ChecklistItemRow
            key={item.id}
            item={item}
            mutate={mutate}
            busy={busy}
          />
        ))}
      </div>
      {addingItem && (
        <form
          className="inline-add-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await mutate({
                type: "checklist.item.create",
                checklistId: list.id,
                title: itemTitle,
              })
            ) {
              setItemTitle("");
              setAddingItem(false);
              addItemButton.current?.focus();
            }
          }}
        >
          <Input
            ref={itemInput}
            aria-label={`Nuevo elemento de ${list.title}`}
            placeholder="Añadir un elemento…"
            value={itemTitle}
            onChange={(e) => setItemTitle(e.target.value)}
            maxLength={300}
            required
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setItemTitle("");
                setAddingItem(false);
                addItemButton.current?.focus();
              }
            }}
          />
          <Button
            variant="outline"
            type="submit"
            size="icon"
            disabled={busy || !itemTitle.trim()}
            aria-label={`Añadir elemento a ${list.title}`}
          >
            <Plus size={16} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Cancelar nuevo ítem"
            onClick={() => {
              setItemTitle("");
              setAddingItem(false);
              addItemButton.current?.focus();
            }}
          >
            <X size={15} />
          </Button>
        </form>
      )}
    </div>
  );
}

function ChecklistItemRow({
  item,
  mutate,
  busy,
}: {
  item: ChecklistItem;
  mutate: Mutate;
  busy: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(item.title);
  return (
    <div className={`checklist-item ${item.completed ? "is-completed" : ""}`}>
      <input
        type="checkbox"
        checked={item.completed}
        disabled={busy}
        aria-label={`Completar ${item.title}`}
        onChange={(e) =>
          mutate({
            type: "checklist.item.update",
            id: item.id,
            title: item.title,
            completed: e.target.checked,
          })
        }
      />
      {editing ? (
        <form
          className="inline-add-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await mutate({
                type: "checklist.item.update",
                id: item.id,
                title,
                completed: item.completed,
              })
            )
              setEditing(false);
          }}
        >
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            maxLength={300}
            aria-label="Editar elemento"
            autoFocus
          />
          <Button
            type="submit"
            size="icon"
            disabled={busy}
            aria-label="Guardar elemento"
          >
            <Check />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="Cancelar edición de elemento"
            onClick={() => {
              setTitle(item.title);
              setEditing(false);
            }}
          >
            <X />
          </Button>
        </form>
      ) : (
        <>
          <span>{item.title}</span>
          <Button
            variant="ghost"
            size="icon"
            disabled={busy}
            aria-label={`Editar ${item.title}`}
            onClick={() => setEditing(true)}
          >
            <Pencil size={13} />
          </Button>
        </>
      )}
      <Button
        variant="ghost"
        size="icon"
        className="danger"
        disabled={busy}
        aria-label={`Eliminar elemento ${item.title}`}
        onClick={() => mutate({ type: "checklist.item.delete", id: item.id })}
      >
        <Trash2 size={13} />
      </Button>
    </div>
  );
}

function Comments({
  task,
  mutate,
  busy,
  confirm,
  content,
  setContent,
}: {
  task: Task;
  mutate: Mutate;
  busy: boolean;
  confirm: (value: Confirmation) => void;
  content: string;
  setContent: (value: string) => void;
}) {
  const thread = useRef<HTMLDivElement>(null);
  const lastId = task.comments.at(-1)?.id;
  useEffect(() => {
    if (thread.current) thread.current.scrollTop = thread.current.scrollHeight;
  }, [lastId]);
  return (
    <>
      <div
        className="comment-list"
        ref={thread}
        role="log"
        aria-label="Conversación de la tarea"
        aria-live="polite"
        aria-relevant="additions text"
      >
        {task.comments.map((comment) => (
          <Comment
            key={comment.id}
            comment={comment}
            mutate={mutate}
            busy={busy}
            confirm={confirm}
          />
        ))}
        {!task.comments.length && (
          <div className="comments-empty">
            <MessageSquare size={30} />
            <p>Aún no hay mensajes.</p>
            <span>Comparte una nota o un avance de esta tarea.</span>
          </div>
        )}
      </div>
      <form
        className="comment-composer"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!content.trim() || busy) return;
          if (
            await mutate({ type: "comment.create", taskId: task.id, content })
          )
            setContent("");
        }}
      >
        <div className="comment-composer-input">
          <AutoTextarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            aria-label="Escribir comentario"
            placeholder="Escribe un mensaje…"
            maxLength={10000}
            rows={2}
            required
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <Button
            type="submit"
            disabled={busy || !content.trim()}
            size="icon"
            aria-label="Enviar comentario"
            title="Enviar comentario"
          >
            <Send size={17} />
          </Button>
        </div>
        <span className="composer-hint">
          Enter para enviar · Mayús + Enter para una nueva línea
        </span>
      </form>
    </>
  );
}

function Comment({
  comment,
  mutate,
  busy,
  confirm,
}: {
  comment: TaskComment;
  mutate: Mutate;
  busy: boolean;
  confirm: (value: Confirmation) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(comment.content);
  return (
    <article className="comment">
      <div className="comment-meta">
        <span className="comment-avatar">T</span>
        <strong>Tú</strong>
        <time
          dateTime={comment.createdAt}
          title={timestamp(comment.createdAt, true)}
        >
          {timestamp(comment.createdAt, true)}
        </time>
      </div>
      {editing ? (
        <form
          className="form-stack"
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await mutate({ type: "comment.update", id: comment.id, content })
            )
              setEditing(false);
          }}
        >
          <AutoTextarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            aria-label="Editar comentario"
            maxLength={10000}
            required
          />
          <div className="comment-actions">
            <Button size="sm" type="submit" disabled={busy}>
              Guardar
            </Button>
            <Button
              size="sm"
              type="button"
              variant="ghost"
              onClick={() => {
                setContent(comment.content);
                setEditing(false);
              }}
            >
              Cancelar
            </Button>
          </div>
        </form>
      ) : (
        <p className="comment-content">{comment.content}</p>
      )}
      {!editing && (
        <div className="comment-actions">
          {comment.updatedAt !== comment.createdAt && (
            <span className="field-hint">Editado</span>
          )}
          <button disabled={busy} onClick={() => setEditing(true)}>
            Editar
          </button>
          <button
            disabled={busy}
            onClick={() =>
              confirm({
                title: "¿Eliminar este comentario?",
                description: "Esta acción es permanente.",
                action: () =>
                  mutate({ type: "comment.delete", id: comment.id }),
              })
            }
          >
            Eliminar
          </button>
        </div>
      )}
    </article>
  );
}
