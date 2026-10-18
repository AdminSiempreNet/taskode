"use client";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckSquare,
  FileText,
  History,
  Layers3,
  ListChecks,
  Loader2,
  MessageSquare,
  Paperclip,
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
import { ClientPicker } from "./client-picker";
import { InlineTaskTitle, TaskLabelPicker } from "./task-heading";
import { FeatureCombobox } from "./feature-combobox";
import { TaskAssignments } from "./task-people";
import { TaskDocuments } from "./task-documents";
import { ResizableTaskPanels } from "./resizable-task-panels";
import { DetailTabs } from "./detail-tabs";
import { TaskComments } from "./task-comments";
import { uploadFile } from "@/lib/file-client";
import { DescriptionEditor } from "./description-editor";
import { useUnsavedChanges } from "./unsaved-changes";
import { useTaskComments } from "./use-task-comments";
import {
  getProjectView,
  projectPath,
  taskPath,
  safeReturnTo,
} from "@/lib/routes";
import type {
  Checklist,
  ChecklistItem,
  Project,
  Task,
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
  const searchParams = useSearchParams();
  const view = getProjectView(searchParams.get("view"));
  const returnTo = safeReturnTo(project.id, searchParams.get("returnTo"));
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
  const [clientIds, setClientIds] = useState(task?.clientIds ?? []);
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
  const [leaderId, setLeaderId] = useState(
    task?.leaderId ?? workspace.currentUser.id,
  );
  const [teamMemberIds, setTeamMemberIds] = useState(task?.teamMemberIds ?? []);
  const assignmentSaving = useRef(false);
  const [uploading, setUploading] = useState(0);
  const canManage = !task || (task.permissions?.canManageAccess ?? true);
  const people = (workspace.people ?? []).filter(
    (p) => p.projectId === project.id,
  );
  const [dirty, setDirty] = useState(false);
  const [descriptionEditing, setDescriptionEditing] = useState(false);
  const [activeTab, setActiveTab] = useState("description");
  const [documentCount, setDocumentCount] = useState(task?.files?.length ?? 0);
  useEffect(() => {
    setDocumentCount(task?.files?.length ?? 0);
  }, [task?.id, task?.files]);
  const [chatOpen, setChatOpen] = useState(false);
  const [mobileComments, setMobileComments] = useState(false);
  const [commentDraft, setCommentDraft] = useState("");
  const conversation = useTaskComments(task, workspace.currentUser);
  useEffect(() => {
    if (conversation.connection === "denied") {
      toast.error("La sesión terminó o ya no tienes acceso a esta tarea.");
      router.replace(projectPath(project.id, view));
    }
  }, [conversation.connection, project.id, router, view]);
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
  const { requestNavigation, leaveDialog } = useUnsavedChanges(
    pending || !!commentDraft.trim(),
    busy,
  );
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
  async function saveAssignment(
    nextLeaderId: string,
    nextTeamMemberIds: string[],
  ) {
    if (busy || assignmentSaving.current || !canManage) return false;
    const next = nextTeamMemberIds.filter((id) => id !== nextLeaderId);
    if (!task) {
      setLeaderId(nextLeaderId);
      setTeamMemberIds(next);
      setDirty(true);
      return true;
    }
    assignmentSaving.current = true;
    try {
      const result = await mutate({
        type: "task.assignment.update",
        id: task.id,
        leaderId: nextLeaderId,
        teamMemberIds: next,
      });
      if (!result) return false;
      setLeaderId(nextLeaderId);
      setTeamMemberIds(next);
      return true;
    } finally {
      assignmentSaving.current = false;
    }
  }
  async function saveClients(values: string[]) {
    if (busy || assignmentSaving.current) return;
    const previous = clientIds;
    setClientIds(values);
    if (!task) {
      setDirty(true);
      return;
    }
    assignmentSaving.current = true;
    try {
      if (
        !(await mutate({
          type: "task.clients.update",
          id: task.id,
          clientIds: values,
        }))
      )
        setClientIds(previous);
    } finally {
      assignmentSaving.current = false;
    }
  }
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
    if (uploading) return;
    if (!title.trim()) {
      toast.error("Escribe un título para la tarea.");
      document
        .querySelector<HTMLElement>('[aria-label="Título de la tarea"]')
        ?.focus();
      return;
    }
    const result = await mutate({
      type: task ? "task.update" : "task.create",
      ...(!task ? { leaderId, teamMemberIds, clientIds } : {}),
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
      if (!task && result.createdId) {
        const feature = features.find((f) => f.id === featureId);
        const keepAccess =
          leaderId === workspace.currentUser.id ||
          teamMemberIds.includes(workspace.currentUser.id) ||
          workspace.currentUser.role === "admin" ||
          project.leaderId === workspace.currentUser.id ||
          feature?.leaderId === workspace.currentUser.id ||
          workspace.modules.some(
            (m) =>
              m.id === feature?.moduleId &&
              m.leaderId === workspace.currentUser.id,
          );
        router.replace(
          keepAccess
            ? taskPath(project.id, result.createdId, view)
            : projectPath(project.id, view),
        );
      }
    }
  }
  const commentContents = (
    <>
      <div className="section-heading chat-heading">
        <span className="chat-heading-icon">
          <MessageSquare size={18} />
        </span>
        <div className="chat-heading-copy">
          {mobileComments ? (
            <DialogTitle>Comentarios</DialogTitle>
          ) : (
            <h2>Comentarios</h2>
          )}
          <span
            className="chat-heading-status"
            role="status"
            data-state={conversation.connection}
          >
            <i aria-hidden="true" />
            {!task
              ? "Conversación de la tarea"
              : conversation.connection === "live"
                ? "En tiempo real"
                : conversation.connection === "polling"
                  ? "Conectado"
                  : conversation.connection === "connecting"
                    ? "Conectando…"
                    : "Reconectando…"}
          </span>
        </div>
        <span
          className="subtle-count"
          aria-label={`${task ? conversation.comments.length : 0} mensajes`}
        >
          {task ? conversation.comments.length : 0}
        </span>
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
        <TaskComments
          task={task}
          currentUserId={workspace.currentUser.id}
          comments={conversation.comments}
          pending={conversation.pending}
          error={conversation.error}
          mutate={conversation.mutate}
          busy={conversation.sending || conversation.connection === "denied"}
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
                router.push(returnTo ?? projectPath(project.id, view)),
              )
            }
          >
            <ArrowLeft size={17} />
            {returnTo
              ? "Volver"
              : view === "list"
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
          <TaskAssignments
            people={people}
            leaderId={leaderId}
            teamMemberIds={teamMemberIds}
            onSave={saveAssignment}
            busy={busy}
            canManage={canManage}
            isNew={!task}
          />
          <Button
            type="submit"
            form="task-detail-form"
            className="task-save-button"
            onMouseDown={(event) => event.preventDefault()}
            data-pending={pending}
            aria-label={task ? "Guardar" : "Crear tarea"}
            title={
              pending
                ? "Hay cambios sin guardar"
                : "Todos los cambios guardados"
            }
            disabled={busy || uploading > 0 || !features.length}
          >
            {busy ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Check size={16} />
            )}
            <span>{task ? "Guardar" : "Crear tarea"}</span>
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
            {!!task && !!conversation.comments.length && (
              <span>{conversation.comments.length}</span>
            )}
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
                {task.archived ? (
                  <ArchiveRestore size={16} />
                ) : (
                  <Archive size={16} />
                )}
                {task.archived ? "Restaurar" : "Archivar"}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="danger"
                aria-label="Eliminar tarea"
                disabled={busy || !canManage}
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
      <ResizableTaskPanels comments={commentContents} mobile={mobileComments}>
        <section className="task-detail-main">
          <div className="task-heading">
            <InlineTaskTitle
              value={title}
              change={setTitle}
              commit={saveTitle}
              busy={busy}
            />
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
          </div>
          {task?.archived && (
            <p className="info-note">
              Esta tarea está archivada. Puedes editarla o restaurarla.
            </p>
          )}
          <div className="task-edit-area">
            <DetailTabs
              value={activeTab}
              change={(value) => {
                setActiveTab(value);
                if (value !== "description") setDescriptionEditing(false);
              }}
              label="Secciones de la tarea"
              sections={[
                {
                  id: "description",
                  label: "Descripción",
                  icon: <FileText size={17} />,
                },
                {
                  id: "properties",
                  label: "Propiedades",
                  icon: <Layers3 size={16} />,
                },
                {
                  id: "checklists",
                  label: "Checklist",
                  icon: <ListChecks size={17} />,
                  count: task?.checklists[0]?.items.length,
                },
                {
                  id: "documents",
                  label: "Documentos",
                  icon: <Paperclip size={16} />,
                  count: documentCount,
                },
                {
                  id: "history",
                  label: "Historial",
                  icon: <History size={16} />,
                  count: task?.statusHistory?.length,
                },
              ]}
            >
              <Tabs.Content
                value="description"
                forceMount
                hidden={activeTab !== "description"}
                className="task-tab-panel task-description-panel"
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
                    uploadImage={async (file) =>
                      (await uploadFile(file, project.id, task?.id, "image"))
                        .url
                    }
                    onUploadingChange={setUploading}
                  />
                </form>
              </Tabs.Content>
              <Tabs.Content
                value="properties"
                forceMount
                hidden={activeTab !== "properties"}
                className="task-properties task-tab-panel"
              >
                <section
                  className="task-property-section"
                  aria-label="Propiedades"
                >
                  <h2>Propiedades</h2>
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
                        disabled={busy || !canManage}
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
                          label={label}
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
                    <Field label="Ticket" htmlFor="task-ticket">
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
                      <span>Inicio</span>
                      <div>
                        <Input
                          type="date"
                          form="task-detail-form"
                          aria-label="Fecha de inicio"
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
                          aria-label="Hora de inicio"
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
                      <span>Entrega</span>
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
                          aria-label="Hora de entrega"
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
                </section>
                <section
                  className="task-property-section"
                  aria-label="Clientes"
                >
                  <h2>Clientes</h2>
                  <ClientPicker
                    id="task-clients"
                    clients={workspace.clients ?? []}
                    values={clientIds}
                    onChange={(values) => void saveClients(values)}
                    mutate={mutate}
                    busy={busy}
                  />
                </section>
              </Tabs.Content>
              <Tabs.Content
                value="documents"
                forceMount
                hidden={activeTab !== "documents"}
                className="task-tab-panel"
              >
                <div>
                  {task ? (
                    <TaskDocuments
                      task={task}
                      onCountChange={setDocumentCount}
                      limit={workspace.settings?.maxAttachmentBytes ?? 10485760}
                    />
                  ) : (
                    <p className="field-hint">
                      Guarda la tarea para adjuntar documentos.
                    </p>
                  )}
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
                            <i style={{ background: change.fromStatusColor }} />
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
            </DetailTabs>
          </div>
        </section>
      </ResizableTaskPanels>
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
