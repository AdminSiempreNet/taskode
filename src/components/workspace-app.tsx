"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useWorkspaceRouter } from "./unsaved-changes";
import Link from "next/link";
import {
  Archive,
  ArrowLeft,
  DatabaseBackup,
  ArrowUpRight,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  FolderKanban,
  Layers3,
  LayoutGrid,
  List,
  Loader2,
  MoreHorizontal,
  Menu,
  Pencil,
  Plus,
  Search,
  Settings2,
  Code2,
  Upload,
  Users,
  Ticket as TicketIcon,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ProjectSelector } from "./project-selector";
import { FeatureSidebar } from "./feature-sidebar";
import { ResizableSidebar } from "./resizable-sidebar";
import { Board, Empty, ListView } from "./views";
import { CalendarView } from "./calendar-view";
import {
  Confirm,
  WorkspaceModal,
  type Confirmation,
  type Modal,
  type MutationResult,
} from "./forms";
import type {
  Client,
  Workspace,
  Task,
  EntityDetailSnapshot,
  EntityKind,
} from "@/lib/types";
import {
  entityPath,
  getProjectView,
  projectPath,
  taskPath,
} from "@/lib/routes";
import { ProjectCatalog } from "./project-catalog";
import { SettingsModal } from "./settings-modal";
import { BackupModal } from "./backup-modal";
import { EntityDetail } from "./entity-detail";
import { TaskDetail, type TaskDefaults } from "./task-detail";
import { ClientsManager } from "./clients-manager";
import { TicketsManager } from "./tickets";
import { invalidateMentionOptions } from "./mentions";
import { Dashboard, ProjectsDirectory } from "./dashboard";
import type { DashboardScope } from "@/lib/dashboard";
import { AccountMenu, ProfileModal } from "./account-menu";
import { NotificationBell, NotificationsPage } from "./notifications";
import { UsersManager } from "./users-manager";
import { ProjectPeopleModal } from "./project-people";
import { useProjectFilter } from "./status-filter";
import { TaskFilterControls } from "./task-filter-controls";
import {
  MINE_FILTER,
  UNASSIGNED_FILTER,
  matchesTaskFilters,
} from "@/lib/task-filters";
import { taskMatchesText } from "@/lib/task-search";
import {
  filterGroupValues,
  groupedFilterIds,
  taskFilterOptions,
} from "@/lib/task-filter-options";
import { readPreference } from "@/lib/preferences";
import { normalizeWorkspaceSnapshot } from "@/lib/workspace";
import type { CatalogTicket } from "@/lib/catalogs";
import type { Paginated } from "@/lib/pagination";
import {
  readProjectPreferences,
  rememberProject,
  saveProjectPreferences,
  type ProjectPreferences,
} from "@/lib/project-navigation";

export function WorkspaceApp({
  initialWorkspace,
  projectId = "",
  taskId = "",
  taskDefaults,
  initialTaskCreation,
  menuSection,
  entityRoute,
  initialEntityDetail,
  dashboardScope,
  initialNow,
  notificationOpenId,
  initialClientsPage,
  initialTicketsPage,
}: {
  initialWorkspace: Workspace;
  initialClientsPage?: Paginated<Client>;
  initialTicketsPage?: Paginated<CatalogTicket>;
  projectId?: string;
  taskId?: string;
  taskDefaults?: TaskDefaults;
  initialTaskCreation?: TaskDefaults;
  menuSection?: "dashboard" | "clients" | "tickets" | "projects" | "notifications" | "users";
  notificationOpenId?: string;
  entityRoute?: { kind: Exclude<EntityKind, "task">; id: string };
  initialEntityDetail?: EntityDetailSnapshot;
  dashboardScope?: DashboardScope;
  initialNow?: string;
}) {
  const menuMode = !!menuSection;
  const workspaceUrl = menuSection === "clients" || menuSection === "tickets"
    ? "/api/workspace?catalogs=none" : "/api/workspace";
  const contextRoute = entityRoute ?? dashboardScope;
  const router = useWorkspaceRouter();
  const searchParams = useSearchParams();
  const view = getProjectView(searchParams.get("view"));
  const [workspaceSnapshot, setWorkspace] = useState<Workspace | null>(
    initialWorkspace,
  );
  const workspace = useMemo(
    () => workspaceSnapshot ? normalizeWorkspaceSnapshot(workspaceSnapshot) : null,
    [workspaceSnapshot],
  );
  const [featureId, setFeatureId] = useState(
    searchParams.get("featureId") ?? "all",
  );
  const [projectPreferences, setProjectPreferences] =
    useState<ProjectPreferences>({
      favorites: [],
      recent: [],
    });
  const [search, setSearch] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const sidebarTrigger = useRef<HTMLButtonElement>(null);
  const desktopSidebarTrigger = useRef<HTMLButtonElement>(null);
  const [archived, setArchived] = useState(false);
  const [modal, setModal] = useState<Modal | null>(
    initialTaskCreation
      ? { type: "task", defaults: initialTaskCreation }
      : null,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [busy, setBusy] = useState(false);
  const mutating = useRef(false);
  const openingMenuDialog = useRef(false);
  const [loadError, setLoadError] = useState("");
  const [backupOpen, setBackupOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const selectProject = useCallback(
    (id: string) => {
      setMobileSidebarOpen(false);
      router.push(projectPath(id), { scroll: false });
    },
    [router],
  );
  const load = useCallback(async () => {
    setLoadError("");
    try {
      const r = await fetch(workspaceUrl, { cache: "no-store" });
      if (r.status === 401) {
        window.location.assign("/login");
        return;
      }
      if (!r.ok) throw new Error("No se pudo cargar tu espacio.");
      const w: Workspace = await r.json();
      setWorkspace(w);
      if (
        !menuMode &&
        !w.projects.some((project) => project.id === projectId)
      ) {
        const destination = w.projects[0]
          ? projectPath(w.projects[0].id)
          : "/projects";
        if (projectId || w.projects.length)
          router.replace(destination, { scroll: false });
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Error de conexión.");
    }
  }, [projectId, router, menuMode, workspaceUrl]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    try {
      setSidebarCollapsed(
        readPreference("taskode.sidebar-collapsed") === "true",
      );
    } catch {
      // The sidebar also works when browser storage is unavailable.
    }
  }, []);
  useEffect(() => {
    if (
      modal ||
      settingsOpen ||
      backupOpen ||
      profileOpen ||
      peopleOpen
    )
      setMobileSidebarOpen(false);
  }, [modal, settingsOpen, backupOpen, profileOpen, peopleOpen]);
  function toggleSidebar() {
    const collapsed = !sidebarCollapsed;
    setSidebarCollapsed(collapsed);
    window.requestAnimationFrame(() => desktopSidebarTrigger.current?.focus());
    try {
      localStorage.setItem("taskode.sidebar-collapsed", String(collapsed));
    } catch {
      // Keep the current preference for this session.
    }
  }
  const mutate = useCallback(
    async (command: unknown): Promise<MutationResult | null> => {
      if (mutating.current) return null;
      mutating.current = true;
      setBusy(true);
      try {
        const r = await fetch(workspaceUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(command),
        });
        if (r.status === 401) {
          window.location.assign("/login");
          return null;
        }
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || "No se pudo guardar.");
        setWorkspace(data.workspace);
        if (/^(client|ticket)\./.test(String((command as { type?: string })?.type))) invalidateMentionOptions();
        const w = data.workspace as Workspace;
        if (
          projectId &&
          !w.projects.some((project) => project.id === projectId)
        ) {
          router.replace(
            w.projects[0] ? projectPath(w.projects[0].id) : "/projects",
            {
              scroll: false,
            },
          );
        }
        setFeatureId((current) =>
          current === "all" || w.features.some((f) => f.id === current)
            ? current
            : "all",
        );
        return data;
      } catch (e) {
        toast.error(
          e instanceof Error
            ? e.message
            : "No se pudo guardar. Comprueba tu conexión.",
        );
        return null;
      } finally {
        mutating.current = false;
        setBusy(false);
      }
    },
    [projectId, router, workspaceUrl],
  );
  const project = workspace?.projects.find((p) => p.id === projectId);
  const currentUserId = workspace?.currentUser.id;
  const activeProjectId = project?.id;
  useEffect(() => {
    if (!currentUserId) return;
    const preferences = readProjectPreferences(currentUserId);
    if (activeProjectId) {
      preferences.recent = [
        activeProjectId,
        ...preferences.recent.filter((id) => id !== activeProjectId),
      ].slice(0, 100);
      rememberProject(currentUserId, activeProjectId);
      saveProjectPreferences(currentUserId, preferences);
    }
    setProjectPreferences(preferences);
  }, [currentUserId, activeProjectId]);
  function toggleProjectFavorite(id: string) {
    if (!currentUserId) return;
    const next = {
      ...projectPreferences,
      favorites: projectPreferences.favorites.includes(id)
        ? projectPreferences.favorites.filter((favoriteId) => favoriteId !== id)
        : [...projectPreferences.favorites, id],
    };
    setProjectPreferences(next);
    saveProjectPreferences(currentUserId, next);
  }
  const canManageProject =
    !!workspace &&
    (workspace.currentUser.role === "admin" ||
      project?.leaderId === workspace.currentUser.id);
  const selectedTask = workspace?.tasks.find(
    (task) => task.id === taskId && task.projectId === projectId,
  );
  const showTaskDetail = !!taskId && (taskId === "new" || !!selectedTask);
  const features =
    workspace?.features.filter((f) => f.projectId === projectId) ?? [];
  const statuses =
    workspace?.statuses.filter((s) => s.projectId === projectId) ?? [];
  const taskTypes =
    workspace?.taskTypes?.filter((option) => option.projectId === projectId) ??
    [];
  const impacts =
    workspace?.impacts?.filter((option) => option.projectId === projectId) ??
    [];
  const priorities =
    workspace?.priorities.filter((option) => option.projectId === projectId) ??
    [];
  const labels =
    workspace?.labels.filter((option) => option.projectId === projectId) ?? [];
  const filterOptions = taskFilterOptions(workspace, projectId);
  const [selectedStatusIds, setStatusIds] = useProjectFilter(
    projectId,
    "status",
    statuses,
  );
  const [selectedTypeIds, setTypeIds] = useProjectFilter(
    projectId,
    "type",
    taskTypes,
    true,
  );
  const [selectedImpactIds, setImpactIds] = useProjectFilter(
    projectId,
    "impact",
    impacts,
    true,
  );
  const [selectedPriorityIds, setPriorityIds] = useProjectFilter(
    projectId,
    "priority",
    priorities,
  );
  const [selectedApplicationIds, setApplicationIds] = useProjectFilter(projectId, "application", workspace?.applications.filter(option => option.projectId === projectId) ?? [], true);
  const [selectedLabelIds, setLabelIds] = useProjectFilter(
    projectId,
    "label",
    labels,
    true,
  );
  const [selectedUserIds, setUserIds] = useProjectFilter(
    `${currentUserId ?? ""}.${projectId}`,
    "user",
    filterOptions.userOptions,
    false,
    [MINE_FILTER],
  );
  // Keep the existing per-category preferences while combining their controls.
  const stateFilterIds = [
    ...groupedFilterIds(selectedStatusIds, "status"),
    ...groupedFilterIds(selectedLabelIds, "label"),
  ];
  const classificationFilterIds = [
    ...groupedFilterIds(selectedPriorityIds, "priority"),
    ...groupedFilterIds(selectedTypeIds, "type"),
    ...groupedFilterIds(selectedImpactIds, "impact"),
    ...groupedFilterIds(selectedApplicationIds, "application"),
  ];
  const hasCategoryFilters =
    selectedUserIds.length !== 1 ||
    selectedUserIds[0] !== MINE_FILTER ||
    selectedStatusIds.length > 0 ||
    selectedTypeIds.length > 0 ||
    selectedImpactIds.length > 0 ||
    selectedApplicationIds.length > 0 ||
    selectedPriorityIds.length > 0 ||
    selectedLabelIds.length > 0;
  const allTasks =
    workspace?.tasks.filter((t) => t.projectId === projectId) ?? [];
  const active = allTasks.filter((t) => !t.archived);
  const selectedLabelNames = labels
    .filter((label) => selectedLabelIds.includes(label.id))
    .map((label) => label.name);
  const tasks = allTasks.filter(
    (t) =>
      t.archived === archived &&
      (featureId === "all" || t.featureId === featureId) &&
      matchesTaskFilters(t, {
        userIds: selectedUserIds,
        currentUserId,
        statusIds: selectedStatusIds,
        typeIds: selectedTypeIds,
        impactIds: selectedImpactIds,
        applicationIds: selectedApplicationIds,
        priorityIds: selectedPriorityIds,
        labelNames: selectedLabelNames,
        includeUnlabeled: selectedLabelIds.includes(UNASSIGNED_FILTER),
      }) &&
      taskMatchesText(t, workspace?.tickets ?? [], search),
  );
  const selectedFeature = features.find((f) => f.id === featureId);
  const openTask = (t: Task) => router.push(taskPath(projectId, t.id, view));
  const addTask = (
    statusId?: string,
    startDate?: string,
    startTime?: string,
  ) => {
    if (!features.length) {
      setModal({ type: "feature" });
      toast.info("Crea una feature para agrupar tus tareas.");
      return;
    }
    setModal({
      type: "task",
      defaults: {
        featureId: featureId !== "all" ? featureId : undefined,
        statusId,
        startDate,
        startTime,
      },
    });
  };
  const desktopSidebarControl = (
    <Button
      className="sidebar-desktop-toggle sidebar-edge-toggle"
      variant="ghost"
      size="icon"
      ref={desktopSidebarTrigger}
      aria-label={
        sidebarCollapsed ? "Expandir barra lateral" : "Contraer barra lateral"
      }
      title={
        sidebarCollapsed ? "Expandir barra lateral" : "Contraer barra lateral"
      }
      aria-expanded={!sidebarCollapsed}
      aria-controls="workspace-sidebar"
      onClick={toggleSidebar}
    >
      <span className="sidebar-edge-toggle-icon" aria-hidden="true">
        {sidebarCollapsed ? (
          <ChevronRight size={18} />
        ) : (
          <ChevronLeft size={18} />
        )}
      </span>
    </Button>
  );
  const sidebarControls = (
    <Button
      className="sidebar-mobile-toggle"
      variant="outline"
      size="icon"
      ref={sidebarTrigger}
      aria-label="Abrir barra lateral"
      title="Abrir barra lateral"
      aria-expanded={mobileSidebarOpen}
      aria-controls="workspace-sidebar"
      aria-haspopup="dialog"
      onClick={() => setMobileSidebarOpen(true)}
    >
      <Menu size={18} />
    </Button>
  );
  return (
    <ProjectCatalog.Provider
      value={{
        timeZone: project?.timeZone,
        taskTypes,
        impacts,
        applications: workspace?.applications.filter(option => option.projectId === projectId) ?? [],
        priorities:
          workspace?.priorities.filter((p) => p.projectId === projectId) ?? [],
        labels:
          workspace?.labels.filter((l) => l.projectId === projectId) ?? [],
      }}
    >
      <div
        className="app-shell"
        data-sidebar-collapsed={sidebarCollapsed}
        data-page-scroll={menuMode || !!dashboardScope}
      >
        <ResizableSidebar
          collapsed={sidebarCollapsed}
          edgeControl={desktopSidebarControl}
          mobileOpen={mobileSidebarOpen}
          onMobileOpenChange={setMobileSidebarOpen}
          triggerRef={sidebarTrigger}
          collapsedActions={
            workspace && <NotificationBell userId={workspace.currentUser.id} />
          }
          footer={
            workspace && (
              <div className="sidebar-bottom">
                <NotificationBell userId={workspace.currentUser.id} />
                <AccountMenu
                  user={workspace.currentUser}
                  busy={busy}
                  onProfile={() => setProfileOpen(true)}
                  onImport={() => setModal({ type: "import" })}
                  onSettings={() => setSettingsOpen(true)}
                  onBackup={() => setBackupOpen(true)}
                  onUsers={() => router.push(`/users${projectId ? `?tab=invitations&projectId=${encodeURIComponent(projectId)}` : ""}`)}
                />
              </div>
            )
          }
        >
          <div className="sidebar-navigation">
            <div
              className="view-tabs sidebar-tabs"
              role="group"
              aria-label="Secciones del espacio"
            >
              <button
                type="button"
                className={`sidebar-menu-button ${menuMode ? "active-view" : ""}`}
                aria-label="Menú"
                title="Menú"
                aria-pressed={menuMode}
                disabled={busy}
                onClick={() => {
                  if (menuMode) return;
                  setMobileSidebarOpen(false);
                  router.push("/dashboard", { scroll: false });
                }}
              >
                <Menu size={16} aria-hidden="true" />
              </button>
              <ProjectSelector
                projects={workspace?.projects ?? []}
                project={project}
                preferences={projectPreferences}
                loading={!workspace}
                disabled={busy}
                onSelect={selectProject}
                onToggleFavorite={toggleProjectFavorite}
                onCreate={() => setModal({ type: "project" })}
              >
                <button
                  type="button"
                  className={`sidebar-project-button ${!menuMode ? "active-view" : ""}`}
                  aria-pressed={!menuMode}
                  disabled={busy || !workspace}
                  title={
                    project
                      ? `Cambiar proyecto. Actual: ${project.name}`
                      : "Seleccionar proyecto"
                  }
                >
                  <span className="sidebar-project-icon" aria-hidden="true">
                    {!menuMode && project?.icon ? (
                      project.icon
                    ) : (
                      <FolderKanban size={16} />
                    )}
                  </span>
                  <span className="sidebar-project-label">
                    {!menuMode && project ? project.name : "Proyectos"}
                  </span>
                  <ChevronDown size={13} aria-hidden="true" />
                </button>
              </ProjectSelector>
            </div>
          </div>
          <div className="sidebar-panel">
            {project ? (
              <FeatureSidebar
                userId={workspace!.currentUser.id}
                canReorder={canManageProject}
                key={projectId}
                projectId={project?.id}
                features={features}
                taskTypes={taskTypes}
                modules={
                  workspace?.modules.filter(
                    (module) => module.projectId === projectId,
                  ) ?? []
                }
                selectedId={featureId}
                counts={Object.fromEntries(
                  features.map((feature) => [
                    feature.id,
                    active.filter((task) => task.featureId === feature.id)
                      .length,
                  ]),
                )}
                busy={busy}
                select={(id) => {
                  setFeatureId(id);
                  setMobileSidebarOpen(false);
                  if (taskId || entityRoute || dashboardScope) {
                    const path = projectPath(projectId, view);
                    router.push(
                      `${path}${path.includes("?") ? "&" : "?"}featureId=${encodeURIComponent(id)}`,
                    );
                  }
                }}
                createFeature={() =>
                  setModal({
                    type: "feature",
                    ...(contextRoute?.kind === "module"
                      ? {
                          moduleId:
                            contextRoute.id === "general"
                              ? null
                              : contextRoute.id,
                        }
                      : {}),
                  })
                }
                createModule={() => setModal({ type: "module" })}
                createTask={(typeId) =>
                  setModal({
                    type: "task",
                    defaults: {
                      typeId,
                      featureId:
                        contextRoute?.kind === "feature"
                          ? contextRoute.id
                          : (selectedFeature?.id ?? selectedTask?.featureId),
                    },
                  })
                }
                edit={(feature) =>
                  router.push(
                    entityPath(projectId, "feature", feature.id, view),
                  )
                }
                editModule={(module) =>
                  router.push(entityPath(projectId, "module", module.id, view))
                }
                mutate={mutate}
              />
            ) : menuMode ? (
              <nav className="application-menu" aria-label="Menú principal">
                <Link
                  href="/dashboard"
                  className="nav-item"
                  aria-current={
                    menuSection === "dashboard" ? "page" : undefined
                  }
                  onClick={() => setMobileSidebarOpen(false)}
                >
                  <LayoutGrid size={17} />
                  Dashboard
                </Link>
                <Link
                  href="/projects"
                  className="nav-item"
                  aria-current={menuSection === "projects" ? "page" : undefined}
                  onClick={() => setMobileSidebarOpen(false)}
                >
                  <FolderKanban size={17} />
                  Proyectos
                </Link>
                <Link
                  href="/clients"
                  className="nav-item"
                  aria-current={menuSection === "clients" ? "page" : undefined}
                  onClick={() => setMobileSidebarOpen(false)}
                >
                  <Users size={17} />
                  Clientes
                </Link>
                <Link href="/tickets" className="nav-item" aria-current={menuSection === "tickets" ? "page" : undefined} onClick={() => setMobileSidebarOpen(false)}>
                  <TicketIcon size={17} />Tickets
                </Link>
                {workspace?.currentUser.role === "admin" && <Link href="/users" className="nav-item" aria-current={menuSection === "users" ? "page" : undefined} onClick={() => setMobileSidebarOpen(false)}><Users size={17} />Usuarios e invitaciones</Link>}
              </nav>
            ) : null}
          </div>
        </ResizableSidebar>
        <div className="main-shell">
          {(loadError ||
            !workspace ||
            (!project && menuSection !== "dashboard" && menuSection !== "projects") ||
            (taskId && !showTaskDetail)) && (
            <div className="workspace-navigation">{sidebarControls}</div>
          )}
          <main id="workspace-main">
            <span className="sr-only" role="status">
              {busy ? "Guardando cambios…" : "Todos los cambios guardados"}
            </span>
            {loadError ? (
              <Empty
                icon={<CircleHelp />}
                title="No pudimos abrir tu espacio"
                description={loadError}
                action={<Button onClick={load}>Volver a intentar</Button>}
              />
            ) : !workspace ? (
              <div className="loading-state">
                <Loader2 className="animate-spin" />
                <span>Preparando tu espacio…</span>
              </div>
            ) : menuMode ? (
              menuSection === "users" ? <UsersManager projects={workspace.projects} refreshWorkspace={load} /> : menuSection === "notifications" ? <NotificationsPage userId={workspace.currentUser.id} openId={notificationOpenId} /> : menuSection === "clients" ? (
                <ClientsManager
                  clients={workspace.clients ?? []}
                  initialPage={initialClientsPage}
                  mutate={mutate}
                  busy={busy}
                  confirm={setConfirmation}
                />
              ) : menuSection === "tickets" ? (
                <TicketsManager tickets={workspace.tickets} clients={workspace.clients} initialPage={initialTicketsPage} mutate={mutate} busy={busy} confirm={setConfirmation} />
              ) : menuSection === "projects" ? (
                <ProjectsDirectory
                  workspace={workspace}
                  createProject={() => setModal({ type: "project" })}
                  sidebarControls={sidebarControls}
                />
              ) : (
                <Dashboard
                  workspace={workspace}
                  initialNow={initialNow!}
                  refresh={load}
                  createProject={() => setModal({ type: "project" })}
                  sidebarControls={sidebarControls}
                />
              )
            ) : !project ? (
              <Empty
                icon={<Code2 />}
                title="Todo empieza con una idea"
                description="Crea tu primer proyecto o trae tus tareas desde Trello. Tu próximo logro empieza aquí."
                action={
                  <>
                    <Button onClick={() => setModal({ type: "project" })}>
                      <Plus />
                      Crear proyecto
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setModal({ type: "import" })}
                    >
                      <Upload />
                      Importar Trello
                    </Button>
                  </>
                }
              />
            ) : dashboardScope ? (
              <Dashboard
                workspace={workspace}
                scope={dashboardScope}
                initialNow={initialNow!}
                refresh={load}
                createProject={() => setModal({ type: "project" })}
                sidebarControls={sidebarControls}
              />
            ) : entityRoute ? (
              <EntityDetail
                scope={{ ...entityRoute, projectId }}
                initialDetail={initialEntityDetail}
                project={project}
                workspace={workspace}
                mutate={mutate}
                busy={busy}
                confirm={setConfirmation}
                create={setModal}
                sidebarControls={sidebarControls}
              />
            ) : taskId ? (
              showTaskDetail ? (
                <TaskDetail
                  key={taskId}
                  task={selectedTask}
                  sidebarControls={sidebarControls}
                  project={project}
                  workspace={workspace}
                  defaults={taskDefaults}
                  mutate={mutate}
                  busy={busy}
                  confirm={setConfirmation}
                />
              ) : (
                <Empty
                  icon={<CircleHelp />}
                  title="Tarea no encontrada"
                  description="Esta tarea ya no existe en este proyecto."
                  action={
                    <Button
                      onClick={() => router.push(projectPath(projectId, view))}
                    >
                      Volver al proyecto
                    </Button>
                  }
                />
              )
            ) : (
              <>
                <h1 className="sr-only">{project.name}</h1>
                <div className="view-toolbar">
                  <div className="view-navigation">
                    {sidebarControls}
                    <div
                      className="view-tabs"
                      role="tablist"
                      aria-label="Vistas del proyecto"
                    >
                      {(
                        [
                          { id: "board", label: "Tablero", icon: LayoutGrid },
                          { id: "list", label: "Lista", icon: List },
                          {
                            id: "calendar",
                            label: "Calendario",
                            icon: CalendarDays,
                          },
                        ] as const
                      ).map((v) => (
                        <button
                          key={v.id}
                          role="tab"
                          aria-selected={view === v.id}
                          className={view === v.id ? "active-view" : ""}
                          onClick={() => {
                            const url = new URL(window.location.href);
                            if (v.id === "board")
                              url.searchParams.delete("view");
                            else url.searchParams.set("view", v.id);
                            window.history.replaceState(null, "", url);
                          }}
                        >
                          <v.icon size={16} />
                          {v.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="search-field">
                    <Search size={15} />
                    <Input
                      aria-label="Buscar tareas"
                      placeholder="Buscar tareas…"
                      title="Buscar por título, descripción, etiquetas o número de ticket"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                    {search && (
                      <button
                        aria-label="Limpiar búsqueda"
                        onClick={() => setSearch("")}
                      >
                        <X size={13} />
                      </button>
                    )}
                  </div>
                  <div className="view-tools">
                    <TaskFilterControls
                      idPrefix="workspace"
                      className="task-filters"
                      options={filterOptions}
                      userIds={selectedUserIds}
                      stateIds={stateFilterIds}
                      classificationIds={classificationFilterIds}
                      changeUsers={setUserIds}
                      changeState={(ids) => {
                        setStatusIds(filterGroupValues(ids, "status"));
                        setLabelIds(filterGroupValues(ids, "label"));
                      }}
                      changeClassification={(ids) => {
                        setPriorityIds(filterGroupValues(ids, "priority"));
                        setTypeIds(filterGroupValues(ids, "type"));
                        setImpactIds(filterGroupValues(ids, "impact"));
                        setApplicationIds(filterGroupValues(ids, "application"));
                      }}
                    />
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="outline"
                          size="icon"
                          disabled={busy}
                          aria-label="Opciones del proyecto"
                          title="Opciones del proyecto"
                        >
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="end"
                        className="project-actions-menu"
                        onCloseAutoFocus={(event) => {
                          if (openingMenuDialog.current) {
                            event.preventDefault();
                            openingMenuDialog.current = false;
                          }
                        }}
                      >
                        <DropdownMenuLabel className="project-menu-heading">
                          <strong>
                            {project.icon} {project.name}
                          </strong>
                          {project.description && (
                            <span>{project.description}</span>
                          )}
                        </DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onSelect={() =>
                            router.push(
                              entityPath(projectId, "project", projectId, view),
                            )
                          }
                        >
                          <Pencil />
                          {canManageProject
                            ? "Editar proyecto"
                            : "Ver proyecto"}
                        </DropdownMenuItem>
                        {canManageProject && (
                          <DropdownMenuItem
                            onSelect={() => {
                              openingMenuDialog.current = true;
                              setPeopleOpen(true);
                            }}
                          >
                            <Users />
                            Líder y equipo
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          onSelect={() => {
                            setArchived(!archived);
                            setSearch("");
                          }}
                        >
                          <Archive />
                          {archived
                            ? "Volver a las tareas"
                            : "Tareas archivadas"}
                          <span className="menu-count">
                            {allTasks.filter((t) => t.archived).length}
                          </span>
                        </DropdownMenuItem>
                        {selectedFeature && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onSelect={() =>
                                router.push(
                                  entityPath(
                                    projectId,
                                    "feature",
                                    selectedFeature.id,
                                    view,
                                  ),
                                )
                              }
                            >
                              <Pencil />
                              Editar feature
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
                {(archived ||
                  selectedFeature ||
                  search ||
                  hasCategoryFilters) && (
                  <div className="content-context">
                    <div>
                      <h2>
                        {archived
                          ? "Tareas archivadas"
                          : (selectedFeature?.name ?? "Todas las features")}
                      </h2>
                      <span>
                        {tasks.length} {tasks.length === 1 ? "tarea" : "tareas"}
                      </span>
                      {(search || hasCategoryFilters) && (
                        <button
                          className="clear-filters"
                          onClick={() => {
                            setSearch("");
                            setUserIds([MINE_FILTER]);
                            setStatusIds([]);
                            setTypeIds([]);
                            setImpactIds([]);
                            setApplicationIds([]);
                            setPriorityIds([]);
                            setLabelIds([]);
                          }}
                        >
                          Limpiar filtros
                          <X size={12} />
                        </button>
                      )}
                    </div>
                    <div className="context-actions">
                      {selectedFeature && (
                        <button
                          className="context-button"
                          onClick={() =>
                            router.push(
                              entityPath(
                                projectId,
                                "feature",
                                selectedFeature.id,
                                view,
                              ),
                            )
                          }
                        >
                          <MoreHorizontal size={14} />
                          Editar feature
                        </button>
                      )}
                      {archived && (
                        <button
                          className="context-button"
                          onClick={() => setArchived(false)}
                        >
                          <ArrowLeft size={14} />
                          Volver a las tareas
                        </button>
                      )}
                    </div>
                  </div>
                )}
                <div className="view-content" data-view={view}>
                  {view === "board" ? (
                    !features.length ? (
                      <Empty
                        icon={<Layers3 />}
                        title="Dale forma a tu proyecto"
                        description="Crea una feature para agrupar tus primeras tareas."
                        action={
                          <Button onClick={() => setModal({ type: "feature" })}>
                            <Plus />
                            Crear feature
                          </Button>
                        }
                      />
                    ) : (
                      <Board
                        tasks={tasks}
                        statuses={statuses.filter(
                          (s) =>
                            !selectedStatusIds.length ||
                            selectedStatusIds.includes(s.id),
                        )}
                        features={features}
                        open={openTask}
                        add={(status) => addTask(status)}
                        mutate={mutate}
                        busy={busy}
                        archived={archived}
                      />
                    )
                  ) : view === "list" ? (
                    <ListView
                      tasks={tasks}
                      features={features.filter(
                        (f) => featureId === "all" || f.id === featureId,
                      )}
                      statuses={statuses}
                      open={openTask}
                      add={() => addTask()}
                      archived={archived}
                    />
                  ) : (
                    <CalendarView
                      timeZone={project.timeZone}
                      tasks={tasks}
                      statuses={statuses}
                      open={openTask}
                      add={(date, time) => addTask(undefined, date, time)}
                      archived={archived}
                      busy={busy}
                    />
                  )}
                </div>
              </>
            )}
          </main>
        </div>
        {modal && workspace && (
          <WorkspaceModal
            key={
              modal.type +
              ("feature" in modal
                ? (modal.feature?.id ?? "new")
                : "module" in modal
                  ? (modal.module?.id ?? "new")
                  : "project" in modal
                    ? (modal.project?.id ?? "new")
                    : "")
            }
            modal={modal}
            close={() => {
              setModal(null);
              if (initialTaskCreation)
                router.replace(projectPath(projectId, view));
            }}
            project={project}
            workspace={workspace}
            mutate={mutate}
            busy={busy}
            confirm={setConfirmation}
            selectProject={selectProject}
          />
        )}
        {settingsOpen && workspace && (
          <SettingsModal
            project={canManageProject ? project : undefined}
            workspace={workspace}
            mutate={mutate}
            busy={busy}
            close={() => setSettingsOpen(false)}
            confirm={setConfirmation}
          />
        )}
        {profileOpen && workspace && (
          <ProfileModal
            user={workspace.currentUser}
            close={() => setProfileOpen(false)}
          />
        )}
        {peopleOpen && project && workspace && canManageProject && (
          <ProjectPeopleModal
            project={project}
            currentUser={workspace.currentUser}
            mutate={mutate}
            close={() => setPeopleOpen(false)}
          />
        )}
        {backupOpen && workspace?.currentUser.role === "admin" && (
          <BackupModal close={() => setBackupOpen(false)} />
        )}
        <Confirm
          value={confirmation}
          close={() => setConfirmation(null)}
          busy={busy}
        />
      </div>
    </ProjectCatalog.Provider>
  );
}
