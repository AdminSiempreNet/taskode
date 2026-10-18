"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Tabs } from "radix-ui";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  FileText,
  GitBranch,
  Layers3,
  LayoutDashboard,
  Loader2,
  MessageSquare,
  Paperclip,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type {
  EntityDetailSnapshot,
  EntityRef,
  Feature,
  Project,
  Workspace,
} from "@/lib/types";
import { entityNames } from "@/lib/entities";
import { canViewDashboard } from "@/lib/dashboard";
import {
  entityPath,
  dashboardPath,
  getProjectView,
  projectPath,
  safeReturnTo,
} from "@/lib/routes";
import { formatFeatureNumber } from "@/lib/features";
import { uploadFile } from "@/lib/file-client";
import { Button } from "./ui/button";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "./ui/dialog";
import {
  Colors,
  Field,
  type Confirmation,
  type Modal,
  type Mutate,
} from "./forms";
import { InlineTitle } from "./task-heading";
import { DescriptionEditor } from "./description-editor";
import { EmojiPicker } from "./emoji-picker";
import { EntityAssignmentControl } from "./project-people";
import { DetailTabs, type DetailSection } from "./detail-tabs";
import { EntityDiagrams, type DiagramPending } from "./diagrams";
import { EntityDocuments, type DocumentPending } from "./documents";
import { EntityTable } from "./entity-table";
import { EntityFiles } from "./task-files";
import { EntityComments } from "./task-comments";
import { ResizableTaskPanels } from "./resizable-task-panels";
import { useEntityComments } from "./use-task-comments";
import { useUnsavedChanges } from "./unsaved-changes";
import { FeatureTaskList } from "./feature-task-list";
import { UserAvatar } from "./user-avatar";
import styles from "./module-features.module.css";

export function EntityDetail({
  scope,
  initialDetail,
  project,
  workspace,
  mutate,
  busy,
  confirm,
  create,
  sidebarControls,
}: {
  scope: EntityRef;
  initialDetail?: EntityDetailSnapshot;
  project: Project;
  workspace: Workspace;
  mutate: Mutate;
  busy: boolean;
  confirm: (value: Confirmation) => void;
  create: (modal: Modal) => void;
  sidebarControls: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const query = useSearchParams();
  const view = getProjectView(query.get("view"));
  const general = scope.kind === "module" && scope.id === "general";
  const [detail, setDetail] = useState(initialDetail);
  const modules = workspace.modules.filter((m) => m.projectId === project.id);
  const features = workspace.features.filter((f) => f.projectId === project.id);
  const entity =
    scope.kind === "project"
      ? project
      : scope.kind === "module"
        ? modules.find((m) => m.id === scope.id)
        : features.find((f) => f.id === scope.id);
  const [name, setName] = useState(entity?.name ?? "General");
  const [description, setDescription] = useState(entity?.description ?? "");
  const [icon, setIcon] = useState(project.icon);
  const [color, setColor] = useState(project.color);
  const [moduleId, setModuleId] = useState(
    (entity as Feature | undefined)?.moduleId ?? "general",
  );
  const [editing, setEditing] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [fileCount, setFileCount] = useState(detail?.files.length ?? 0);
  const [archived, setArchived] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [draft, setDraft] = useState("");
  const [documentState, setDocumentState] = useState<DocumentPending>({ pending: false, busy: false });
  const [diagramState, setDiagramState] = useState<DiagramPending>({ pending: false, busy: false });
  const conversation = useEntityComments(
    general ? undefined : scope,
    workspace.currentUser,
  );
  const canEdit = detail?.permissions.canEdit ?? false;
  const canReorder =
    workspace.currentUser.role === "admin" ||
    project.leaderId === workspace.currentUser.id;
  const pending =
    !general &&
    !!entity &&
    (name !== entity.name ||
      description !== entity.description ||
      (scope.kind === "project" &&
        (icon !== project.icon || color !== project.color)) ||
      (scope.kind === "feature" &&
        moduleId !== ((entity as Feature).moduleId ?? "general")));
  const { requestNavigation, leaveDialog } = useUnsavedChanges(
    pending || !!draft.trim() || diagramState.pending || documentState.pending,
    busy || uploading > 0 || diagramState.busy || documentState.busy,
    documentState.pending ? "documento" : diagramState.pending ? "diagrama" : entityNames[scope.kind],
  );
  const childTab =
    scope.kind === "project"
      ? "modules"
      : scope.kind === "module"
        ? "features"
        : "tasks";
  const sections: DetailSection[] = general
    ? []
    : [
        {
          id: "description",
          label: "Descripción",
          icon: <FileText size={17} />,
        },
        { id: "properties", label: "Propiedades", icon: <Layers3 size={17} /> },
        {
          id: "files",
          label: "Archivos",
          icon: <Paperclip size={17} />,
          count: fileCount,
        },
        { id: "documents", label: "Documentos", icon: <FileText size={17} /> },
        { id: "diagrams", label: "Diagramas", icon: <GitBranch size={17} /> },
      ];
  const childFeatures = features.filter(
    (f) => f.moduleId === (general ? null : scope.id),
  );
  const featureTasks = workspace.tasks.filter(
    (t) => t.featureId === scope.id && t.projectId === project.id,
  );
  sections.push({
    id: childTab,
    label:
      childTab === "modules"
        ? "Módulos"
        : childTab === "features"
          ? "Features"
          : "Tareas",
    icon: <Layers3 size={17} />,
    count:
      scope.kind === "project"
        ? modules.length + 1
        : scope.kind === "module"
          ? childFeatures.length
          : featureTasks.filter((t) => t.archived === archived).length,
  });
  const requestedTab = query.get("tab");
  const tab = sections.some((s) => s.id === requestedTab)
    ? requestedTab!
    : general
      ? "features"
      : "description";
  const currentPath = `${pathname}${query.size ? `?${query}` : ""}`;
  const fallback =
    scope.kind === "project"
      ? projectPath(project.id, view)
      : scope.kind === "module"
        ? entityPath(project.id, "project", project.id, view, "modules")
        : entityPath(
            project.id,
            "module",
            (entity as Feature | undefined)?.moduleId ?? "general",
            view,
            "features",
          );
  const back = safeReturnTo(project.id, query.get("returnTo")) ?? fallback;
  const people = (workspace.people ?? []).filter(
    (p) => p.projectId === project.id,
  );
  const leaderName = (id?: string) =>
    people.find((p) => p.id === id)?.name ??
    (id === workspace.currentUser.id ? workspace.currentUser.name : "—");
  const navigate = (path: string) => requestNavigation(() => router.push(path));
  const open = (kind: EntityRef["kind"], id: string) =>
    navigate(entityPath(project.id, kind, id, view, undefined, currentPath));

  useEffect(() => {
    setFileCount(detail?.files.length ?? 0);
  }, [detail?.files]);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 900px)");
    const update = () => {
      setMobile(media.matches);
      if (!media.matches) setChatOpen(false);
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (conversation.connection === "denied") {
      toast.error("La sesión terminó o ya no tienes acceso a este elemento.");
      router.replace(projectPath(project.id, view));
    }
  }, [conversation.connection, router, project.id, view]);

  async function refreshDetail() {
    const response = await fetch(
      `/api/entities/${scope.kind}/${encodeURIComponent(scope.id)}`,
      { cache: "no-store" },
    );
    if ([401, 403, 404].includes(response.status)) {
      router.replace(projectPath(project.id, view));
      return;
    }
    if (!response.ok) throw new Error("No se pudo actualizar el detalle.");
    setDetail(await response.json());
  }
  const apply: Mutate = async (command) => {
    const result = await mutate(command);
    if (result && !general) {
      try {
        await refreshDetail();
      } catch (error) {
        toast.error((error as Error).message);
      }
    }
    return result;
  };
  async function saveName(value: string) {
    if (!canEdit || busy || !entity) return;
    const next = value.trim();
    if (!next) {
      setName(entity.name);
      toast.error("El nombre no puede estar vacío.");
      return;
    }
    setName(next);
    if (next !== entity.name)
      await apply({ type: `${scope.kind}.rename`, id: scope.id, name: next });
  }
  async function save() {
    if (!canEdit || busy || uploading || !name.trim()) return;
    const result = await apply({
      type: `${scope.kind}.update`,
      id: scope.id,
      name: name.trim(),
      description,
      ...(scope.kind === "project" ? { icon, color } : {}),
      ...(scope.kind === "feature"
        ? { moduleId: moduleId === "general" ? null : moduleId }
        : {}),
    });
    if (result) {
      setName(name.trim());
      setEditing(false);
      toast.success("Cambios guardados.");
    }
  }
  function remove() {
    confirm({
      title: `¿Eliminar ${scope.kind === "feature" ? "esta" : "este"} ${entityNames[scope.kind]}?`,
      description:
        scope.kind === "module"
          ? "Sus features pasarán a General y conservarán sus tareas. Se eliminarán los comentarios, archivos y documentos propios del módulo."
          : "Se eliminarán el elemento, sus comentarios, documentos y todos sus elementos dependientes, incluidas las tareas archivadas. Esta acción es permanente.",
      action: async () => {
        if (await mutate({ type: `${scope.kind}.delete`, id: scope.id }))
          router.replace(scope.kind === "project" ? "/projects" : fallback);
      },
    });
  }
  async function reorder(offset: number) {
    if (!canReorder || busy || !entity) return;
    const items = scope.kind === "module" ? modules : features;
    const group =
      scope.kind === "module"
        ? modules
        : features.filter((f) => f.moduleId === (entity as Feature).moduleId);
    const index = group.findIndex((item) => item.id === scope.id);
    const target = group[index + offset];
    if (!target) return;
    const ids = items.map((item) => item.id);
    const from = ids.indexOf(scope.id),
      to = ids.indexOf(target.id);
    [ids[from], ids[to]] = [ids[to], ids[from]];
    await apply({ type: `${scope.kind}.reorder`, projectId: project.id, ids });
  }
  const orderGroup =
    scope.kind === "module"
      ? modules
      : features.filter(
          (f) => f.moduleId === (entity as Feature | undefined)?.moduleId,
        );
  const orderIndex = orderGroup.findIndex((item) => item.id === scope.id);
  const newFeature = () =>
    create({ type: "feature", moduleId: general ? null : scope.id });
  const children =
    scope.kind === "project" ? (
      <div className="list-view">
        <EntityTable
          title="Módulos"
          count={modules.length + 1}
          icon={<Layers3 size={16} />}
          columns={["Código", "Módulo", "Líder", "Features"]}
          action={
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => create({ type: "module" })}
            >
              <Plus size={15} />
              Nuevo módulo
            </Button>
          }
        >
          {[
            { id: "general", name: "General", leaderId: undefined },
            ...modules,
          ].map((m, index) => (
            <tr key={m.id} onClick={() => open("module", m.id)}>
              <td>{String(index).padStart(2, "0")}</td>
              <td>
                <button
                  type="button"
                  className="table-task"
                  onClick={(event) => {
                    event.stopPropagation();
                    open("module", m.id);
                  }}
                >
                  {m.name}
                </button>
              </td>
              <td>{leaderName(m.leaderId)}</td>
              <td>
                {
                  features.filter(
                    (f) => f.moduleId === (m.id === "general" ? null : m.id),
                  ).length
                }
              </td>
            </tr>
          ))}
        </EntityTable>
      </div>
    ) : scope.kind === "module" ? (
      <div className="list-view">
        <EntityTable
          title="Features"
          className={styles.table}
          count={childFeatures.length}
          icon={<Layers3 size={16} />}
          columns={["N.º", "Feature", "Líder", "Tareas"]}
          action={
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={newFeature}
            >
              <Plus size={15} />
              Nueva feature
            </Button>
          }
        >
          {childFeatures.map((f) => {
            const leader =
              people.find((person) => person.id === f.leaderId) ??
              (f.leaderId === workspace.currentUser.id
                ? workspace.currentUser
                : undefined);
            return (
              <tr key={f.id} onClick={() => open("feature", f.id)}>
                <td>{formatFeatureNumber(f.number)}</td>
                <td>
                  <button
                    type="button"
                    className="table-task"
                    onClick={(event) => {
                      event.stopPropagation();
                      open("feature", f.id);
                    }}
                  >
                    {f.name}
                  </button>
                </td>
                <td>
                  {leader ? (
                    <span className={styles.leader} title={leader.name}>
                      <UserAvatar name={leader.name} image={leader.image} />
                      <span className={styles.leaderName}>{leader.name}</span>
                    </span>
                  ) : (
                    <span className={styles.unset}>Sin líder</span>
                  )}
                </td>
                <td>
                  {
                    workspace.tasks.filter(
                      (t) => t.featureId === f.id && !t.archived,
                    ).length
                  }
                </td>
              </tr>
            );
          })}
          {!childFeatures.length && (
            <tr>
              <td colSpan={4}>Todavía no hay features en este grupo.</td>
            </tr>
          )}
        </EntityTable>
      </div>
    ) : (
      <FeatureTaskList
        projectId={project.id}
        featureId={scope.id}
        workspace={workspace}
        tasks={featureTasks}
        archived={archived}
        changeArchived={setArchived}
        open={(task) => open("task", task.id)}
        add={() => create({ type: "task", defaults: { featureId: scope.id } })}
      />
    );
  const main = (
    <section
      className={`task-detail-main ${general ? "entity-general-main" : ""}`}
    >
      <div className="task-heading">
        <InlineTitle
          kind={scope.kind}
          value={name}
          change={setName}
          commit={saveName}
          busy={busy}
          readOnly={general || !canEdit}
          maxLength={160}
          label={`Nombre ${scope.kind === "feature" ? "de la" : "del"} ${entityNames[scope.kind]}`}
        />
      </div>
      <div className="task-edit-area">
        <DetailTabs
          value={tab}
          change={(value) => {
            if (diagramState.busy || documentState.busy) return;
            requestNavigation(() => {
              const next = new URLSearchParams(query.toString());
              next.set("tab", value);
              next.delete("diagram");
              next.delete("document");
              window.history.replaceState(null, "", `${pathname}?${next}`);
              setEditing(false);
            }, diagramState.pending || documentState.pending);
          }}
          label="Secciones del detalle"
          sections={sections}
        >
          {!general && (
            <>
              <Tabs.Content value="documents" className="task-tab-panel">
                {tab === "documents" && <EntityDocuments scope={scope} guard={(action) => requestNavigation(action, documentState.pending)} onPendingChange={setDocumentState} />}
              </Tabs.Content>
              <Tabs.Content value="diagrams" className="task-tab-panel">
                {tab === "diagrams" && <EntityDiagrams scope={scope} guard={(action) => requestNavigation(action, diagramState.pending)} onPendingChange={setDiagramState} />}
              </Tabs.Content>
              <Tabs.Content
                value="description"
                forceMount
                hidden={tab !== "description"}
                className="task-tab-panel task-description-panel"
              >
                <div className="task-description-form">
                  <DescriptionEditor
                    value={description}
                    onChange={setDescription}
                    editing={editing}
                    setEditing={setEditing}
                    label={`Descripción ${scope.kind === "feature" ? "de la" : "del"} ${entityNames[scope.kind]}`}
                    disabled={!canEdit || busy}
                    uploadImage={async (file) =>
                      (await uploadFile(file, project.id, scope, "image")).url
                    }
                    onUploadingChange={setUploading}
                  />
                </div>
              </Tabs.Content>
              <Tabs.Content
                value="properties"
                forceMount
                hidden={tab !== "properties"}
                className="task-tab-panel task-properties"
              >
                <section className="task-property-section">
                  <h2>Propiedades</h2>
                  <fieldset
                    className="form-stack scope-fields"
                    disabled={!canEdit || busy}
                  >
                    {scope.kind === "project" ? (
                      <>
                        <Field label="Icono" htmlFor="entity-icon">
                          <EmojiPicker
                            id="entity-icon"
                            value={icon}
                            onChange={setIcon}
                            emojis={workspace.projects.map((p) => p.icon)}
                            disabled={!canEdit || busy}
                          />
                        </Field>
                        <div className="field">
                          <label>Color</label>
                          <Colors
                            value={color}
                            onChange={setColor}
                            disabled={!canEdit || busy}
                          />
                        </div>
                      </>
                    ) : (
                      <>
                        {scope.kind === "feature" && (
                          <Field label="Módulo" htmlFor="entity-module">
                            <select
                              id="entity-module"
                              disabled={
                                !detail?.permissions.canManageAccess || busy
                              }
                              value={moduleId}
                              onChange={(event) =>
                                setModuleId(event.target.value)
                              }
                            >
                              <option value="general">
                                00 · General (sin módulo)
                              </option>
                              {modules.map((m, i) => (
                                <option key={m.id} value={m.id}>
                                  {String(i + 1).padStart(2, "0")} · {m.name}
                                </option>
                              ))}
                            </select>
                          </Field>
                        )}
                        <div className="feature-order">
                          <span>
                            {scope.kind === "feature"
                              ? "Número de la feature"
                              : "Orden del módulo"}{" "}
                            <strong>
                              {scope.kind === "feature"
                                ? formatFeatureNumber(
                                    (entity as Feature)?.number ?? 0,
                                  )
                                : String(orderIndex + 1).padStart(2, "0")}
                            </strong>
                          </span>
                          <Button
                            type="button"
                            size="icon"
                            variant="outline"
                            disabled={!canReorder || busy || orderIndex <= 0}
                            aria-label="Mover hacia arriba"
                            onClick={() => reorder(-1)}
                          >
                            <ArrowUp size={15} />
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="outline"
                            disabled={
                              !canReorder ||
                              busy ||
                              orderIndex < 0 ||
                              orderIndex >= orderGroup.length - 1
                            }
                            aria-label="Mover hacia abajo"
                            onClick={() => reorder(1)}
                          >
                            <ArrowDown size={15} />
                          </Button>
                        </div>
                      </>
                    )}
                  </fieldset>
                </section>
              </Tabs.Content>
              <Tabs.Content
                value="files"
                forceMount
                hidden={tab !== "files"}
                className="task-tab-panel"
              >
                <EntityFiles
                  scope={scope}
                  active={tab === "files"}
                  files={detail?.files}
                  canEdit={detail?.permissions.canManageFiles ?? false}
                  limit={workspace.settings?.maxAttachmentBytes ?? 10485760}
                  onCountChange={setFileCount}
                />
              </Tabs.Content>
            </>
          )}
          <Tabs.Content
            value={childTab}
            forceMount
            hidden={tab !== childTab}
            className="task-tab-panel"
          >
            {children}
          </Tabs.Content>
        </DetailTabs>
      </div>
    </section>
  );
  const comments = (
    <>
      <div className="section-heading chat-heading">
        <span className="chat-heading-icon">
          <MessageSquare size={18} />
        </span>
        <div className="chat-heading-copy">
          {mobile ? (
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
            {conversation.connection === "live"
              ? "En tiempo real"
              : conversation.connection === "polling"
                ? "Conectado"
                : conversation.connection === "connecting"
                  ? "Conectando…"
                  : "Reconectando…"}
          </span>
        </div>
        <span className="subtle-count">{conversation.comments.length}</span>
        {mobile && (
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
      <EntityComments
        scope={scope}
        currentUserId={workspace.currentUser.id}
        comments={conversation.comments}
        pending={conversation.pending}
        error={conversation.error}
        mutate={conversation.mutate}
        busy={conversation.sending || conversation.connection === "denied"}
        confirm={confirm}
        content={draft}
        setContent={setDraft}
      />
    </>
  );
  return (
    <div className="task-detail-page">
      <header className="task-detail-header">
        <div className="task-header-navigation">
          {sidebarControls}
          <Button
            type="button"
            variant="ghost"
            className="task-back-button"
            onClick={() => navigate(back)}
          >
            <ArrowLeft size={17} />
            Volver
          </Button>
        </div>
        <span>
          {project.icon} {project.name}
        </span>
        <div className="task-header-actions">
          {scope.kind !== "task" &&
            canViewDashboard(workspace, { ...scope, kind: scope.kind }) && (
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  navigate(
                    dashboardPath(
                      project.id,
                      scope.kind as "project" | "module" | "feature",
                      scope.id,
                    ),
                  )
                }
              >
                <LayoutDashboard size={16} />
                Dashboard
              </Button>
            )}
          {!general && (
            <>
              {entity && (
                <EntityAssignmentControl
                  scope={scope}
                  leaderId={entity.leaderId ?? ""}
                  teamMemberIds={entity.teamMemberIds ?? []}
                  people={people}
                  currentUser={workspace.currentUser}
                  canManage={detail?.permissions.canManageAccess ?? false}
                  mutate={apply}
                  busy={busy}
                />
              )}
              {canEdit && (
                <Button
                  type="button"
                  className="task-save-button"
                  data-pending={pending}
                  disabled={busy || uploading > 0 || !pending}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={save}
                >
                  {busy ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Check size={16} />
                  )}
                  Guardar
                </Button>
              )}
              {detail?.permissions.canDelete && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="danger"
                  disabled={busy}
                  aria-label={`Eliminar ${entityNames[scope.kind]}`}
                  onClick={remove}
                >
                  <Trash2 size={17} />
                </Button>
              )}
              {mobile && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setChatOpen(true)}
                >
                  <MessageSquare size={16} />
                  Chat
                </Button>
              )}
            </>
          )}
        </div>
      </header>
      {general ? (
        main
      ) : (
        <ResizableTaskPanels
          comments={comments}
          mobile={mobile}
          label={`Comentarios ${scope.kind === "feature" ? "de la" : "del"} ${entityNames[scope.kind]}`}
        >
          {main}
        </ResizableTaskPanels>
      )}
      <Dialog open={!general && mobile && chatOpen} onOpenChange={setChatOpen}>
        <DialogContent
          className="task-comments task-comments-dialog translate-x-0 translate-y-0"
          showCloseButton={false}
          aria-describedby={undefined}
        >
          {comments}
        </DialogContent>
      </Dialog>
      {leaveDialog}
    </div>
  );
}
