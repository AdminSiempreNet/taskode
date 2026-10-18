"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarDays,
  CheckCheck,
  ChevronRight,
  Clock3,
  FolderKanban,
  LayoutDashboard,
  ListTodo,
  Plus,
  RefreshCw,
  TriangleAlert,
  Users,
  type LucideIcon,
} from "lucide-react";
import {
  assignedTo,
  canViewDashboard,
  dashboardDate,
  dashboardTasks,
  ledScopes,
  personalTasks,
  projectDashboardScope,
  summarizeTasks,
  type DashboardMetrics,
  type DashboardScope,
} from "@/lib/dashboard";
import { dashboardPath, entityPath, projectPath } from "@/lib/routes";
import { searchProjects } from "@/lib/project-navigation";
import type { Task, Workspace } from "@/lib/types";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { UserAvatar } from "./user-avatar";
import styles from "./dashboard.module.css";

function shortDate(value: string | null) {
  if (!value) return "Sin fecha";
  return new Intl.DateTimeFormat("es-CO", {
    day: "numeric",
    month: "short",
    timeZone: "America/Bogota",
  }).format(new Date(`${value}T12:00:00Z`));
}

function Progress({ metrics }: { metrics: DashboardMetrics }) {
  return (
    <div className={styles.progressCell}>
      <div>
        <strong>{metrics.total ? `${metrics.progress}%` : "Sin tareas"}</strong>
        <span>
          {metrics.completed}/{metrics.total}
        </span>
      </div>
      <div
        className={styles.track}
        role="progressbar"
        aria-label="Avance de tareas"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={metrics.progress}
        aria-valuetext={
          metrics.total
            ? `${metrics.completed} de ${metrics.total} tareas terminadas`
            : "Sin tareas"
        }
      >
        <span style={{ width: `${metrics.progress}%` }} />
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  note,
  icon: Icon,
  alert = false,
}: {
  label: string;
  value: string | number;
  note: string;
  icon: LucideIcon;
  alert?: boolean;
}) {
  return (
    <div className={`${styles.metric} ${alert ? styles.metricAlert : ""}`}>
      <div className={styles.metricLabel}>
        {label}
        <Icon size={17} aria-hidden="true" />
      </div>
      <strong className={styles.metricValue}>{value}</strong>
      <span className={styles.muted}>{note}</span>
    </div>
  );
}

type SummaryRow = {
  scope: DashboardScope;
  label: string;
  context?: string;
  tasks: Task[];
  leaderId?: string;
  icon?: string;
};

function SummaryTable({
  title,
  description,
  rows,
  workspace,
  now,
  returnTo,
}: {
  title: string;
  description: string;
  rows: SummaryRow[];
  workspace: Workspace;
  now: Date;
  returnTo: string;
}) {
  return (
    <section className={styles.panel}>
      <div className={styles.panelHeading}>
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <span className={styles.count}>{rows.length}</span>
      </div>
      {!rows.length ? (
        <p className={styles.empty}>Todavía no hay elementos para mostrar.</p>
      ) : (
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Avance</th>
                <th>Abiertas</th>
                <th>Vencidas</th>
                <th>Próxima entrega</th>
                <th>
                  <span className="sr-only">Abrir</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const metrics = summarizeTasks(workspace, row.tasks, now);
                const allowed = canViewDashboard(workspace, row.scope);
                const target = allowed
                  ? dashboardPath(
                      row.scope.projectId,
                      row.scope.kind,
                      row.scope.id,
                    )
                  : row.scope.kind === "project"
                    ? projectPath(row.scope.projectId)
                    : entityPath(
                        row.scope.projectId,
                        row.scope.kind,
                        row.scope.id,
                        "board",
                        undefined,
                        returnTo,
                      );
                const leader = workspace.people?.find(
                  (p) => p.id === row.leaderId,
                );
                return (
                  <tr key={`${row.scope.kind}/${row.scope.id}`}>
                    <td>
                      <Link href={target} className={styles.rowTitle}>
                        <span className={styles.entityIcon} aria-hidden="true">
                          {row.icon || <FolderKanban size={18} />}
                        </span>
                        <span>
                          <strong>{row.label}</strong>
                          <small>
                            {row.context ||
                              (leader ? `Líder: ${leader.name}` : "Proyecto")}
                          </small>
                        </span>
                      </Link>
                    </td>
                    <td>
                      <Progress metrics={metrics} />
                    </td>
                    <td>{metrics.open}</td>
                    <td>
                      <span
                        className={
                          metrics.overdue.length
                            ? styles.alertBadge
                            : styles.muted
                        }
                      >
                        {metrics.overdue.length}
                      </span>
                    </td>
                    <td>
                      {metrics.nextDue
                        ? shortDate(metrics.nextDue.dueDate)
                        : "—"}
                    </td>
                    <td>
                      <Link
                        href={target}
                        className={styles.iconLink}
                        aria-label={`${allowed ? "Dashboard" : "Abrir"}: ${row.label}`}
                      >
                        <ArrowUpRight size={17} />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Agenda({
  workspace,
  metrics,
  returnTo,
}: {
  workspace: Workspace;
  metrics: DashboardMetrics;
  returnTo: string;
}) {
  const groups = [
    { id: "overdue", label: "Vencidas", tasks: metrics.overdue },
    { id: "today", label: "Hoy", tasks: metrics.today },
    { id: "upcoming", label: "Próximos 7 días", tasks: metrics.upcoming },
    { id: "undated", label: "Sin fecha", tasks: metrics.undated },
    { id: "all", label: "Todas", tasks: metrics.agenda },
  ];
  const [selected, setSelected] = useState(
    groups.find((g) => g.tasks.length)?.id ?? "all",
  );
  const [limit, setLimit] = useState(6);
  const group = groups.find((g) => g.id === selected)!;
  return (
    <section className={styles.panel}>
      <div className={styles.panelHeading}>
        <div>
          <h2>Tu siguiente paso</h2>
          <p>Atiende los vencimientos y prepara las próximas entregas.</p>
        </div>
        <CalendarDays size={19} aria-hidden="true" />
      </div>
      <div
        className={styles.queueFilters}
        role="group"
        aria-label="Agenda de tareas"
      >
        {groups.map((g) => (
          <button
            key={g.id}
            type="button"
            aria-pressed={selected === g.id}
            onClick={() => {
              setSelected(g.id);
              setLimit(6);
            }}
          >
            {g.label}
            <span>{g.tasks.length}</span>
          </button>
        ))}
      </div>
      <div aria-live="polite">
        {!group.tasks.length ? (
          <div className={styles.empty}>
            <CheckCheck size={24} aria-hidden="true" />
            <strong>No hay tareas en esta sección</strong>
            <span>
              {selected === "overdue"
                ? "No tienes entregas pendientes fuera de plazo."
                : "Las tareas aparecerán aquí cuando corresponda."}
            </span>
          </div>
        ) : (
          <ul className={styles.agenda}>
            {group.tasks.slice(0, limit).map((task) => {
              const status = workspace.statuses.find(
                (s) => s.id === task.statusId && s.projectId === task.projectId,
              );
              const project = workspace.projects.find(
                (p) => p.id === task.projectId,
              );
              const priority = workspace.priorities.find(
                (p) => p.id === task.priority && p.projectId === task.projectId,
              );
              const isOverdue = metrics.overdue.some((t) => t.id === task.id);
              return (
                <li key={task.id}>
                  <Link
                    href={entityPath(
                      task.projectId,
                      "task",
                      task.id,
                      "board",
                      undefined,
                      returnTo,
                    )}
                    className={styles.agendaLink}
                  >
                    <span
                      className={styles.statusDot}
                      style={{ background: status?.color }}
                      aria-hidden="true"
                    />
                    <span className={styles.taskText}>
                      <strong>{task.title}</strong>
                      <small>
                        {project?.name} · {status?.name}
                        {priority ? ` · ${priority.name}` : ""}
                        {task.leader ? ` · ${task.leader.name}` : ""}
                      </small>
                    </span>
                    <span
                      className={`${styles.due} ${isOverdue ? styles.overdue : ""}`}
                    >
                      <span>{shortDate(task.dueDate)}</span>
                      {task.dueTime && <small>{task.dueTime}</small>}
                    </span>
                    <ChevronRight size={15} aria-hidden="true" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        {group.tasks.length > limit && (
          <button
            type="button"
            className={styles.more}
            onClick={() => setLimit((n) => n + 10)}
          >
            Mostrar más ({group.tasks.length - limit})
          </button>
        )}
      </div>
    </section>
  );
}

function Distribution({
  workspace,
  tasks,
  metrics,
  scope,
}: {
  workspace: Workspace;
  tasks: Task[];
  metrics: DashboardMetrics;
  scope?: DashboardScope;
}) {
  const entries = scope
    ? workspace.statuses
        .filter((s) => s.projectId === scope.projectId)
        .map((s) => ({
          id: s.id,
          name: s.name,
          color: s.color,
          count: tasks.filter((t) => t.statusId === s.id).length,
        }))
    : [
        {
          id: "completed",
          name: "Terminadas",
          color: "var(--dashboard-green)",
          count: metrics.completed,
        },
        {
          id: "open",
          name: "Abiertas",
          color: "var(--dashboard-blue)",
          count: metrics.open,
        },
      ];
  return (
    <section className={styles.panel}>
      <div className={styles.panelHeading}>
        <div>
          <h2>Avance del trabajo</h2>
          <p>Tareas activas, según su estado actual.</p>
        </div>
      </div>
      <div className={styles.distribution}>
        <div
          className={styles.ring}
          style={{
            background: `conic-gradient(var(--dashboard-green) ${metrics.progress}%, var(--muted) 0)`,
          }}
          aria-hidden="true"
        >
          <div>
            <strong>{metrics.total ? `${metrics.progress}%` : "—"}</strong>
            <span>completado</span>
          </div>
        </div>
        <div className={styles.legend}>
          {entries.map((entry) => (
            <div key={entry.id}>
              <span
                className={styles.statusDot}
                style={{ background: entry.color }}
                aria-hidden="true"
              />
              <span>{entry.name}</span>
              <strong>{entry.count}</strong>
            </div>
          ))}
        </div>
      </div>
      <p className={styles.footnote}>
        {metrics.total
          ? `${metrics.completed} de ${metrics.total} tareas terminadas.`
          : "Sin tareas activas."}{" "}
        El avance no depende de los checklists.
      </p>
    </section>
  );
}

function TeamLoad({
  workspace,
  tasks,
  now,
  projectId,
}: {
  workspace: Workspace;
  tasks: Task[];
  now: Date;
  projectId?: string;
}) {
  const people = [
    ...new Map(
      (workspace.people ?? [])
        .filter((p) => !projectId || p.projectId === projectId)
        .map((p) => [p.id, p]),
    ).values(),
  ];
  const rows = people
    .map((person) => ({
      person,
      metrics: summarizeTasks(
        workspace,
        tasks.filter((t) => assignedTo(t, person.id)),
        now,
      ),
    }))
    .sort(
      (a, b) =>
        b.metrics.open - a.metrics.open ||
        a.person.name.localeCompare(b.person.name, "es"),
    );
  const max = Math.max(1, ...rows.map((r) => r.metrics.open));
  return (
    <section className={styles.panel}>
      <div className={styles.panelHeading}>
        <div>
          <h2>Carga del equipo</h2>
          <p>Tareas abiertas por líder e integrante asignado.</p>
        </div>
        <Users size={19} aria-hidden="true" />
      </div>
      {!rows.length ? (
        <p className={styles.empty}>
          El equipo aparecerá aquí al añadir participantes.
        </p>
      ) : (
        <ul className={styles.team}>
          {rows.map(({ person, metrics }) => (
            <li key={person.id}>
              <div className={styles.person}>
                <UserAvatar name={person.name} image={person.image} />
                <span>
                  <strong>{person.name}</strong>
                  <small>{person.email}</small>
                </span>
                <b>
                  {metrics.open}
                  <small>abiertas</small>
                </b>
              </div>
              <div className={styles.loadTrack}>
                <span style={{ width: `${(metrics.open / max) * 100}%` }} />
              </div>
              <div className={styles.teamNote}>
                <span>{metrics.completed} terminadas</span>
                <span className={metrics.overdue.length ? styles.overdue : ""}>
                  {metrics.overdue.length} vencidas
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className={styles.footnote}>
        Una tarea compartida cuenta para cada persona asignada. Los totales
        generales cuentan cada tarea una sola vez.
      </p>
    </section>
  );
}

function TaskBreakdown({
  workspace,
  tasks,
  returnTo,
}: {
  workspace: Workspace;
  tasks: Task[];
  returnTo: string;
}) {
  const [limit, setLimit] = useState(20);
  return (
    <section className={styles.panel}>
      <div className={styles.panelHeading}>
        <div>
          <h2>Tareas de la feature</h2>
          <p>
            Incluye las tareas abiertas y terminadas, sin aplicar filtros del
            tablero.
          </p>
        </div>
        <span className={styles.count}>{tasks.length}</span>
      </div>
      {!tasks.length ? (
        <p className={styles.empty}>
          Esta feature todavía no tiene tareas activas.
        </p>
      ) : (
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Tarea</th>
                <th>Estado</th>
                <th>Líder</th>
                <th>Checklist</th>
                <th>Entrega</th>
              </tr>
            </thead>
            <tbody>
              {tasks.slice(0, limit).map((task) => {
                const status = workspace.statuses.find(
                  (s) =>
                    s.id === task.statusId && s.projectId === task.projectId,
                );
                const items = task.checklists.flatMap((c) => c.items);
                return (
                  <tr key={task.id}>
                    <td>
                      <Link
                        className={styles.rowTitle}
                        href={entityPath(
                          task.projectId,
                          "task",
                          task.id,
                          "board",
                          undefined,
                          returnTo,
                        )}
                      >
                        <strong>{task.title}</strong>
                      </Link>
                    </td>
                    <td>
                      <span
                        className={styles.statusDot}
                        style={{ background: status?.color }}
                        aria-hidden="true"
                      />{" "}
                      {status?.name}
                    </td>
                    <td>{task.leader?.name ?? "—"}</td>
                    <td>
                      {items.length
                        ? `${items.filter((i) => i.completed).length}/${items.length}`
                        : "Sin checklist"}
                    </td>
                    <td>
                      {shortDate(task.dueDate)}
                      {task.dueTime ? ` · ${task.dueTime}` : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {tasks.length > limit && (
        <button
          type="button"
          className={styles.more}
          onClick={() => setLimit((n) => n + 20)}
        >
          Mostrar más tareas
        </button>
      )}
    </section>
  );
}

function Breadcrumbs({
  workspace,
  scope,
}: {
  workspace: Workspace;
  scope: DashboardScope;
}) {
  const project = workspace.projects.find((p) => p.id === scope.projectId)!;
  const feature =
    scope.kind === "feature"
      ? workspace.features.find((f) => f.id === scope.id)
      : undefined;
  const moduleId =
    scope.kind === "module" ? scope.id : (feature?.moduleId ?? "general");
  const module = workspace.modules.find((m) => m.id === moduleId);
  const href = (kind: DashboardScope["kind"], id: string) =>
    canViewDashboard(workspace, { kind, id, projectId: project.id })
      ? dashboardPath(project.id, kind, id)
      : entityPath(project.id, kind, id);
  return (
    <nav className={styles.breadcrumbs} aria-label="Ruta del dashboard">
      <Link href="/dashboard">Dashboard</Link>
      <ChevronRight size={13} />
      <Link href="/projects">Proyectos</Link>
      <ChevronRight size={13} />
      <Link href={href("project", project.id)}>{project.name}</Link>
      {scope.kind !== "project" && (
        <>
          <ChevronRight size={13} />
          <Link href={href("module", moduleId)}>
            {module?.name ?? "General"}
          </Link>
        </>
      )}
      {feature && (
        <>
          <ChevronRight size={13} />
          <span aria-current="page">{feature.name}</span>
        </>
      )}
    </nav>
  );
}

export function Dashboard({
  workspace,
  scope,
  initialNow,
  refresh,
  createProject,
  sidebarControls,
}: {
  workspace: Workspace;
  scope?: DashboardScope;
  initialNow: string;
  refresh: () => Promise<void>;
  createProject: () => void;
  sidebarControls?: ReactNode;
}) {
  const [now, setNow] = useState(() => new Date(initialNow));
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(initialNow);
  useEffect(() => {
    const update = () => setNow(new Date());
    update();
    const timer = window.setInterval(update, 60_000);
    window.addEventListener("focus", update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", update);
    };
  }, []);
  if (scope && !canViewDashboard(workspace, scope))
    return (
      <div className={styles.page}>
        <h1>Dashboard no disponible</h1>
        <p>
          El elemento ya no existe o no tienes permisos para consultar su
          dashboard.
        </p>
        <Link href="/dashboard">Volver a mi dashboard</Link>
      </div>
    );
  const admin = workspace.currentUser.role === "admin";
  const management = !!scope || admin;
  const tasks = scope
    ? dashboardTasks(workspace, scope)
    : admin
      ? dashboardTasks(workspace)
      : personalTasks(workspace);
  const metrics = summarizeTasks(workspace, tasks, now);
  const project =
    scope && workspace.projects.find((p) => p.id === scope.projectId);
  const title =
    scope?.kind === "project"
      ? project?.name
      : scope?.kind === "module"
        ? (workspace.modules.find((m) => m.id === scope.id)?.name ?? "General")
        : scope?.kind === "feature"
          ? workspace.features.find((f) => f.id === scope.id)?.name
          : "Dashboard";
  const returnTo = scope
    ? dashboardPath(scope.projectId, scope.kind, scope.id)
    : "/dashboard";
  const projectRows = workspace.projects.map((p) => ({
    scope: projectDashboardScope(p),
    label: p.name,
    icon: p.icon,
    leaderId: p.leaderId,
    tasks: tasks.filter((t) => t.projectId === p.id),
  }));
  let rows: SummaryRow[] = projectRows;
  if (scope?.kind === "project")
    rows = [
      ...workspace.modules
        .filter((m) => m.projectId === scope.projectId)
        .map((m) => ({
          scope: { ...scope, kind: "module" as const, id: m.id },
          label: m.name,
          leaderId: m.leaderId,
          tasks: dashboardTasks(workspace, {
            ...scope,
            kind: "module",
            id: m.id,
          }),
        })),
      {
        scope: { ...scope, kind: "module", id: "general" },
        label: "General",
        context: "Features sin módulo",
        tasks: dashboardTasks(workspace, {
          ...scope,
          kind: "module",
          id: "general",
        }),
      },
    ];
  if (scope?.kind === "module")
    rows = workspace.features
      .filter(
        (f) =>
          f.projectId === scope.projectId &&
          f.moduleId === (scope.id === "general" ? null : scope.id),
      )
      .map((f) => ({
        scope: { ...scope, kind: "feature", id: f.id },
        label: f.name,
        leaderId: f.leaderId,
        tasks: tasks.filter((t) => t.featureId === f.id),
      }));
  const leadership = !management
    ? ledScopes(workspace).map((s) => ({
        scope: s,
        label:
          s.kind === "project"
            ? workspace.projects.find((p) => p.id === s.id)!.name
            : s.kind === "module"
              ? workspace.modules.find((m) => m.id === s.id)!.name
              : workspace.features.find((f) => f.id === s.id)!.name,
        context: `${s.kind === "project" ? "Proyecto" : s.kind === "module" ? "Módulo" : "Feature"} · Seguimiento de equipo`,
        tasks: dashboardTasks(workspace, s),
      }))
    : [];
  const day = dashboardDate(now).day;
  return (
    <div className={styles.page}>
      {scope && <Breadcrumbs workspace={workspace} scope={scope} />}
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>
            {scope
              ? `Dashboard de ${scope.kind === "project" ? "proyecto" : scope.kind === "module" ? "módulo" : "feature"}`
              : admin
                ? "Visión general · Administración"
                : "Mi espacio · Trabajo y equipo"}
          </span>
          <h1>{title}</h1>
          <p>
            {scope
              ? "Avance, equipo y entregas de este ámbito."
              : admin
                ? "Una mirada clara al avance de tus proyectos y a lo que necesita atención."
                : `Hola, ${workspace.currentUser.name.split(" ")[0]}. Organiza tus entregas y enfoca tu próximo paso.`}
          </p>
        </div>
        <div className={styles.headerActions}>
          {sidebarControls}
          <span className={styles.date}>
            <CalendarDays size={15} />
            {shortDate(day)}
          </span>
          <Button
            variant="outline"
            disabled={refreshing}
            onClick={async () => {
              setRefreshing(true);
              try {
                await refresh();
                const updated = new Date();
                setNow(updated);
                setLastUpdated(updated.toISOString());
              } finally {
                setRefreshing(false);
              }
            }}
          >
            <RefreshCw
              size={15}
              className={refreshing ? "animate-spin" : undefined}
            />
            Actualizar
          </Button>
          {scope && (
            <Button variant="outline" asChild>
              <Link
                href={entityPath(
                  scope.projectId,
                  scope.kind,
                  scope.id,
                  "board",
                  undefined,
                  returnTo,
                )}
              >
                Ver detalle
                <ArrowUpRight size={15} />
              </Link>
            </Button>
          )}
          {scope && scope.kind !== "module" && (
            <Button asChild>
              <Link
                href={`${projectPath(scope.projectId)}${scope.kind === "feature" ? `?featureId=${encodeURIComponent(scope.id)}` : ""}`}
              >
                Abrir tablero
                <ArrowUpRight size={15} />
              </Link>
            </Button>
          )}
          {!scope && (
            <Button asChild>
              <Link href="/projects">
                Ver proyectos
                <ArrowUpRight size={15} />
              </Link>
            </Button>
          )}
        </div>
      </header>
      <div className={styles.metrics}>
        <Metric
          label={
            !scope && admin ? "Proyectos con pendientes" : "Tareas abiertas"
          }
          value={
            !scope && admin
              ? projectRows.filter(
                  (r) => summarizeTasks(workspace, r.tasks, now).open > 0,
                ).length
              : metrics.open
          }
          note={
            !scope && admin
              ? `${workspace.projects.length} proyectos en total`
              : `${metrics.total} tareas activas en total`
          }
          icon={!scope && admin ? FolderKanban : ListTodo}
        />
        <Metric
          label="Avance completado"
          value={metrics.total ? `${metrics.progress}%` : "—"}
          note={
            metrics.total
              ? `${metrics.completed} de ${metrics.total} tareas terminadas`
              : "Sin tareas activas"
          }
          icon={CheckCheck}
        />
        <Metric
          label="Fuera de plazo"
          value={metrics.overdue.length}
          note={
            metrics.overdue.length
              ? "Entregas que requieren atención"
              : "Sin tareas vencidas"
          }
          icon={TriangleAlert}
          alert={metrics.overdue.length > 0}
        />
        <Metric
          label="Entregas para hoy"
          value={metrics.today.length}
          note={`${metrics.upcoming.length} más en los próximos 7 días`}
          icon={Clock3}
        />
      </div>
      {!workspace.projects.length && (
        <section className={styles.welcome}>
          <FolderKanban size={30} />
          <div>
            <h2>Todo empieza con una idea</h2>
            <p>Crea tu primer proyecto para empezar a ver su avance aquí.</p>
          </div>
          <Button onClick={createProject}>
            <Plus size={16} />
            Crear proyecto
          </Button>
        </section>
      )}
      {scope?.kind !== "feature" && (
        <SummaryTable
          title={
            scope?.kind === "project"
              ? "Avance por módulo"
              : scope?.kind === "module"
                ? "Avance por feature"
                : admin
                  ? "Panorama de proyectos"
                  : "Mis proyectos"
          }
          description={
            !management
              ? "Avance de las tareas donde eres líder o parte del equipo."
              : "Identifica el avance y las entregas pendientes de cada equipo."
          }
          rows={rows}
          workspace={workspace}
          now={now}
          returnTo={returnTo}
        />
      )}
      <div className={styles.columns}>
        <Agenda
          key={returnTo}
          workspace={workspace}
          metrics={metrics}
          returnTo={returnTo}
        />
        <div className={styles.stack}>
          <Distribution
            workspace={workspace}
            tasks={tasks}
            metrics={metrics}
            scope={scope}
          />
          {management && (
            <TeamLoad
              workspace={workspace}
              tasks={tasks}
              now={now}
              projectId={scope?.projectId}
            />
          )}
        </div>
      </div>
      {scope?.kind === "feature" && (
        <TaskBreakdown
          workspace={workspace}
          tasks={tasks}
          returnTo={returnTo}
        />
      )}
      {leadership.length > 0 && (
        <SummaryTable
          title="Equipos que lidero"
          description="Seguimiento del trabajo de tus equipos, separado de tu agenda personal."
          rows={leadership}
          workspace={workspace}
          now={now}
          returnTo={returnTo}
        />
      )}
      <footer className={styles.pageFooter}>
        <CheckCheck size={14} />
        Las métricas excluyen las tareas archivadas.
        <span>
          Hora de Bogotá · Actualizado a las{" "}
          {new Intl.DateTimeFormat("es-CO", {
            timeZone: "America/Bogota",
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23",
          }).format(new Date(lastUpdated))}
        </span>
      </footer>
    </div>
  );
}

export function ProjectsDirectory({
  workspace,
  createProject,
  sidebarControls,
}: {
  workspace: Workspace;
  createProject: () => void;
  sidebarControls?: ReactNode;
}) {
  const [query, setQuery] = useState("");
  const projects = searchProjects(workspace.projects, query);
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Espacio de trabajo</span>
          <h1>Proyectos</h1>
          <p>
            Encuentra tu proyecto, consulta su avance o administra sus detalles.
          </p>
        </div>
        <div className={styles.headerActions}>
          {sidebarControls}
          <Button onClick={createProject}>
            <Plus size={16} />
            Nuevo proyecto
          </Button>
        </div>
      </header>
      <div className={styles.directoryToolbar}>
        <label className="sr-only" htmlFor="project-directory-search">
          Buscar proyectos
        </label>
        <Input
          id="project-directory-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar proyectos…"
        />
        <span className={styles.muted}>{projects.length} proyectos</span>
      </div>
      {!projects.length ? (
        <div className={styles.welcome}>
          <FolderKanban size={30} />
          <div>
            <h2>
              {query ? "No encontramos proyectos" : "Todo empieza con una idea"}
            </h2>
            <p>
              {query
                ? "Prueba con otro nombre."
                : "Crea tu primer proyecto para organizar el trabajo de tu equipo."}
            </p>
          </div>
        </div>
      ) : (
        <div className={styles.projectGrid}>
          {projects.map((p) => {
            const allowed = canViewDashboard(
              workspace,
              projectDashboardScope(p),
            );
            const leader = workspace.people?.find((u) => u.id === p.leaderId);
            return (
              <article key={p.id} className={styles.projectCard}>
                <Link
                  href={projectPath(p.id)}
                  className={styles.projectCardTitle}
                >
                  <span
                    style={{
                      background: `color-mix(in srgb, ${p.color} 12%, transparent)`,
                      color: p.color,
                    }}
                    aria-hidden="true"
                  >
                    {p.icon}
                  </span>
                  <h2>{p.name}</h2>
                  <ArrowUpRight size={17} />
                </Link>
                <p className={styles.muted}>
                  Líder: {leader?.name ?? "Sin información"}
                </p>
                <span className={styles.projectRole}>
                  {p.leaderId === workspace.currentUser.id
                    ? "Lideras este proyecto"
                    : workspace.currentUser.role === "admin"
                      ? "Acceso de administrador"
                      : "Miembro del equipo"}
                </span>
                <div className={styles.projectCardActions}>
                  {allowed ? (
                    <>
                      <Button variant="outline" asChild>
                        <Link
                          href={entityPath(
                            p.id,
                            "project",
                            p.id,
                            "board",
                            undefined,
                            "/projects",
                          )}
                        >
                          Editar
                          <ArrowDownRight size={15} />
                        </Link>
                      </Button>
                      <Button asChild>
                        <Link href={dashboardPath(p.id)}>
                          <LayoutDashboard size={15} />
                          Dashboard
                        </Link>
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        variant="outline"
                        disabled
                        title="Requiere ser líder del proyecto o administrador"
                      >
                        Editar
                      </Button>
                      <Button
                        variant="outline"
                        disabled
                        title="Requiere ser líder del proyecto o administrador"
                      >
                        <LayoutDashboard size={15} />
                        Dashboard
                      </Button>
                      <small>
                        Disponible para el líder y el administrador.
                      </small>
                    </>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
