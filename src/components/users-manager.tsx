"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Users, Search, ShieldCheck, ArrowRightLeft, Mail, UserPlus, LayoutGrid, List, ChevronDown, ChevronRight, FolderClosed, LockKeyhole, SearchX, X } from "lucide-react";
import { Tabs } from "radix-ui";
import { toast } from "sonner";
import type { Project } from "@/lib/types";
import type { ManagedUser, UserProjectsSnapshot } from "@/lib/users";
import { fetchJSON } from "@/lib/http-client";
import { InvitationManager } from "./invitation-manager";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { useUnsavedChanges } from "./unsaved-changes";
import { UserAvatar } from "./user-avatar";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";

export function UsersManager({ projects, refreshWorkspace }: { projects: Project[]; refreshWorkspace: () => Promise<void> }) {
  const params = useSearchParams();
  const [tab, setTab] = useState<"users" | "invitations">(params.get("tab") === "invitations" ? "invitations" : "users");
  const [users, setUsers] = useState<ManagedUser[]>([]), [error, setError] = useState("");
  const [loading, setLoading] = useState(true), [query, setQuery] = useState(""), [projectFilter, setProjectFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState(""), [view, setView] = useState<"list" | "grid">("list");
  const [selected, setSelected] = useState<string | null>(params.get("user"));
  const opener = useRef<HTMLButtonElement | null>(null);
  const usersTab = useRef<HTMLButtonElement | null>(null);
  const inviteButton = useRef<HTMLButtonElement | null>(null);
  const [inviteOpen, setInviteOpen] = useState(params.get("tab") === "invitations" && !!params.get("projectId"));
  const [busy, setBusy] = useState(false);
  const reload = useCallback(async () => {
    try { const data = await fetchJSON<{ users: ManagedUser[] }>("/api/users"); setUsers(data.users); setError(""); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void reload(); const focus = () => { void reload(); }; window.addEventListener("focus", focus); return () => window.removeEventListener("focus", focus); }, [reload]);
  // URL navigation has already passed through the shared unsaved-changes guard.
  const routeUserId = params.get("user");
  useEffect(() => { if (routeUserId) { setSelected(routeUserId); setTab("users"); } }, [routeUserId]);
  const filtered = users.filter(u => (!query || `${u.name} ${u.email}`.toLowerCase().includes(query.trim().toLowerCase())) && (!projectFilter || u.role === "admin" || u.projectAccess.some(a => a.projectId === projectFilter)) && (!roleFilter || u.role === roleFilter));
  const hasFilters = !!(query || projectFilter || roleFilter);
  const clearFilters = () => { setQuery(""); setProjectFilter(""); setRoleFilter(""); };
  const changeTab = (next: typeof tab) => { setTab(next); setSelected(null); };
  const invite = () => {
    setTab("invitations"); setInviteOpen(true);
  };
  const manageProjects = (userId: string, button: HTMLButtonElement) => {
    opener.current = button;
    setSelected(userId);
  };
  const userAction = (user: ManagedUser) => user.role === "admin"
    ? <span className="user-admin-access"><LockKeyhole size={13} aria-hidden="true" />Acceso total</span>
    : <Button variant="ghost" size="sm" className="user-manage-button" disabled={busy} aria-label={`Gestionar proyectos de ${user.name}`} onClick={event => manageProjects(user.id, event.currentTarget)}>Gestionar proyectos<ChevronRight size={14} aria-hidden="true" /></Button>;
  return <section className="users-page" aria-labelledby="users-title">
    <header className="users-header">
      <div><p className="users-eyebrow">Administración del espacio</p><h1 id="users-title">Usuarios e invitaciones</h1><p>Conecta a tu equipo y organiza el acceso a tus proyectos.</p></div>
      <Button ref={inviteButton} disabled={busy} onClick={invite}><UserPlus size={16} aria-hidden="true" />Invitar usuario</Button>
    </header>
    <Tabs.Root value={tab} onValueChange={value => changeTab(value as typeof tab)} activationMode="manual">
    <Tabs.List className="users-tabs" aria-label="Gestión de personas">
      <Tabs.Trigger ref={usersTab} value="users" disabled={busy}><Users size={16} aria-hidden="true" />Usuarios<span className="users-count">{loading ? "—" : users.length}</span></Tabs.Trigger>
      <Tabs.Trigger value="invitations" disabled={busy}><Mail size={16} aria-hidden="true" />Invitaciones</Tabs.Trigger>
    </Tabs.List>
    <Tabs.Content value="invitations" className="users-invitations"><InvitationManager layout="directory" open={inviteOpen} onOpenChange={setInviteOpen} restoreFocus={() => inviteButton.current?.focus({ preventScroll: true })} projects={projects} defaultProjectId={params.get("projectId") ?? undefined} onBusy={setBusy} onUpdated={() => { void reload(); void refreshWorkspace(); }} /></Tabs.Content>
    <Tabs.Content value="users" className="users-panel">
      <div className="users-panel-heading"><div><h2>Directorio del equipo</h2><p>Consulta los miembros del espacio y gestiona sus proyectos.</p></div><span className="users-total">{loading ? "Cargando…" : `${users.length} ${users.length === 1 ? "persona" : "personas"}`}</span></div>
      <div className="users-filters">
        <div className="search-field"><Search size={16} aria-hidden="true" /><Input aria-label="Buscar usuarios" placeholder="Buscar por nombre o correo…" value={query} onChange={e => setQuery(e.target.value)} />{query && <button className="users-search-clear" aria-label="Limpiar búsqueda" onClick={() => setQuery("")}><X size={14} /></button>}</div>
        <div className="users-filter-select"><FolderClosed size={15} aria-hidden="true" /><select aria-label="Filtrar usuarios por proyecto" value={projectFilter} onChange={e => setProjectFilter(e.target.value)}><option value="">Todos los proyectos</option>{projects.map(p => <option key={p.id} value={p.id}>{p.icon} {p.name}</option>)}</select><ChevronDown size={13} aria-hidden="true" /></div>
        <div className="users-filter-select users-role-filter"><ShieldCheck size={15} aria-hidden="true" /><select aria-label="Filtrar usuarios por rol" value={roleFilter} onChange={e => setRoleFilter(e.target.value)}><option value="">Todos los roles</option><option value="admin">Administrador</option><option value="member">Usuario</option></select><ChevronDown size={13} aria-hidden="true" /></div>
        <div className="users-view-toggle" role="group" aria-label="Vista del directorio"><button aria-label="Vista de lista" aria-pressed={view === "list"} onClick={() => setView("list")} title="Vista de lista"><List size={16} /></button><button aria-label="Vista de tarjetas" aria-pressed={view === "grid"} onClick={() => setView("grid")} title="Vista de tarjetas"><LayoutGrid size={16} /></button></div>
      </div>
      {error && <p className="form-error" role="alert">{error} <Button variant="ghost" onClick={reload}>Reintentar</Button></p>}
      {loading && <p role="status" className="sr-only">Cargando usuarios…</p>}
      <div className={`users-directory${view === "grid" ? " users-directory-grid" : ""}`} aria-label="Usuarios registrados" aria-busy={loading}>
        {loading ? <div className="users-loading" aria-hidden="true">{Array.from({ length: 5 }, (_, index) => <div className="user-row-skeleton" key={index}><span /><span /><span /></div>)}</div> : !filtered.length ? <div className="users-empty"><span className="users-empty-icon">{hasFilters ? <SearchX size={25} /> : <Users size={25} />}</span><h3>{hasFilters ? "No encontramos coincidencias" : "Tu equipo empieza aquí"}</h3><p>{hasFilters ? "No hay usuarios que coincidan con la búsqueda." : "Invita a las personas con las que compartirás tus proyectos."}</p>{hasFilters ? <Button variant="outline" size="sm" onClick={clearFilters}>Limpiar filtros</Button> : <Button size="sm" onClick={invite}><UserPlus size={15} />Invitar usuario</Button>}</div> : view === "list" ? <table className="users-table">
          <caption className="sr-only">Usuarios y sus accesos a proyectos</caption>
          <thead><tr><th scope="col">Usuario</th><th scope="col">Rol</th><th scope="col">Proyectos</th><th scope="col" className="users-actions-heading">Acceso</th></tr></thead>
          <tbody>{filtered.map(user => <tr key={user.id} className={`user-row${selected === user.id ? " selected" : ""}`}>
            <td><UserIdentity user={user} /></td><td data-label="Rol"><UserRole user={user} /></td><td data-label="Proyectos"><UserProjects user={user} projects={projects} /></td><td className="user-row-action">{userAction(user)}</td>
          </tr>)}</tbody>
        </table> : filtered.map(user => <article key={user.id} className={`user-card${selected === user.id ? " selected" : ""}`}>
          <UserIdentity user={user} /><UserRole user={user} /><div className="user-card-projects"><span className="user-card-label">Proyectos</span><UserProjects user={user} projects={projects} /></div><div className="user-card-action">{userAction(user)}</div>
        </article>)}
      </div>
      <footer className="users-directory-footer"><span role="status">{loading ? "Cargando directorio…" : hasFilters ? `${filtered.length} de ${users.length} personas` : `${users.length} ${users.length === 1 ? "persona en el espacio" : "personas en el espacio"}`}</span><span><ShieldCheck size={13} aria-hidden="true" />Los administradores tienen acceso a todos los proyectos.</span></footer>
    </Tabs.Content>
    </Tabs.Root>
    {selected && <UserAccessEditor key={selected} userId={selected} user={users.find(u => u.id === selected)} onBusy={setBusy} close={() => setSelected(null)} restoreFocus={() => (opener.current?.isConnected ? opener.current : usersTab.current)?.focus({ preventScroll: true })} saved={() => { void reload(); void refreshWorkspace(); }} />}
  </section>;
}

function UserIdentity({ user }: { user: ManagedUser }) {
  return <div className="user-identity"><UserAvatar name={user.name} image={user.image} /><div><h3 title={user.name}>{user.name}</h3><p title={user.email}>{user.email}</p></div></div>;
}

function UserRole({ user }: { user: ManagedUser }) {
  return <span className={`user-role${user.role === "admin" ? " user-role-admin" : ""}`}>{user.role === "admin" && <ShieldCheck size={12} aria-hidden="true" />}{user.role === "admin" ? "Administrador" : "Usuario"}</span>;
}

function UserProjects({ user, projects }: { user: ManagedUser; projects: Project[] }) {
  return <div className="user-project-chips" aria-label={`Proyectos de ${user.name}`}>
    {user.role === "admin" ? <span className="user-all-projects"><FolderClosed size={12} aria-hidden="true" />Todos los proyectos</span> : user.projectAccess.length ? <>{user.projectAccess.slice(0, 2).map(access => {
      const project = projects.find(p => p.id === access.projectId);
      return <span key={access.projectId} title={`${project?.name ?? "Proyecto"}${access.source === "leader" ? " · Líder" : ""}`}><span className="user-project-name">{project?.icon} {project?.name ?? "Proyecto"}</span>{access.source === "leader" && <strong>· Líder</strong>}</span>;
    })}{user.projectAccess.length > 2 && <span title={user.projectAccess.slice(2).map(a => projects.find(p => p.id === a.projectId)?.name ?? "Proyecto").join(", ")} aria-label={`${user.projectAccess.length - 2} proyectos más`}>+{user.projectAccess.length - 2}</span>}</> : <small className="user-no-projects"><span aria-hidden="true" />Sin proyectos asignados</small>}
  </div>;
}

function UserAccessEditor({ userId, user, onBusy, close, restoreFocus, saved }: { userId: string; user?: ManagedUser; onBusy: (v: boolean) => void; close: () => void; restoreFocus: () => void; saved: () => void }) {
  const [snapshot, setSnapshot] = useState<UserProjectsSnapshot | null>(null);
  const [selected, setSelected] = useState<string[]>([]), [replacements, setReplacements] = useState<Record<string, string>>({});
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const reload = useCallback(async () => {
    try { const data = await fetchJSON<UserProjectsSnapshot>(`/api/users/${encodeURIComponent(userId)}/projects`); setSnapshot(data); setSelected(data.user.projectAccess.map(a => a.projectId)); setReplacements({}); setError(""); }
    catch (e) { setError((e as Error).message); }
  }, [userId]);
  useEffect(() => { void reload(); return () => { onBusy(false); }; }, [reload, onBusy]);
  const added = snapshot?.projects.filter(p => !p.access && selected.includes(p.projectId)) ?? [];
  const removed = snapshot?.projects.filter(p => p.access && !selected.includes(p.projectId)) ?? [];
  const dirty = !!(added.length || removed.length);
  const { requestNavigation, leaveDialog } = useUnsavedChanges(dirty, busy, "formulario de accesos");
  const requestClose = () => { if (!busy) requestNavigation(close); };
  async function save() {
    if (!snapshot) return;
    setBusy(true); onBusy(true); setError("");
    try {
      const data = await fetchJSON<UserProjectsSnapshot>(`/api/users/${encodeURIComponent(userId)}/projects`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision: snapshot.revision, addProjectIds: added.map(p => p.projectId), removeProjectIds: removed.map(p => p.projectId), replacements: removed.filter(p => replacements[p.projectId]).map(p => ({ projectId: p.projectId, userId: replacements[p.projectId] })) }) });
      setSnapshot(data); setSelected(data.user.projectAccess.map(a => a.projectId)); setReplacements({}); saved(); toast.success("Accesos actualizados. Los avisos están en cola.");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); onBusy(false); }
  }
  const needsReplacement = removed.some(p => (p.leadsProject || p.tasks || p.modules || p.features) && !replacements[p.projectId]);
  return <Dialog open onOpenChange={open => { if (!open) requestClose(); }}>
    <DialogContent className="users-access-dialog" showCloseButton={false} onCloseAutoFocus={event => { event.preventDefault(); restoreFocus(); }} onEscapeKeyDown={event => { if (busy) event.preventDefault(); }}>
    <DialogHeader className="user-access-header"><div className="user-access-title"><span className="users-section-icon"><FolderClosed size={20} /></span><div><DialogTitle>Gestionar proyectos</DialogTitle><DialogDescription>Define a qué proyectos puede acceder esta persona.</DialogDescription></div><Button variant="ghost" size="icon-sm" disabled={busy} aria-label="Cerrar" onClick={requestClose}><X size={18} /></Button></div><div className="user-access-person">{(snapshot?.user ?? user) ? <UserIdentity user={(snapshot?.user ?? user)!} /> : <span>Cargando accesos…</span>}</div></DialogHeader>
    <div className="user-access-editor" aria-busy={busy}>
    {!snapshot && !error && <p className="user-access-loading" role="status">Cargando accesos…</p>}
    {error && <p className="form-error" role="alert">{error} <Button variant="outline" disabled={busy} onClick={reload}>Recargar accesos</Button></p>}
    {snapshot?.user.role === "admin" ? <p className="users-notice">El administrador tiene acceso automático a todos los proyectos.</p> : snapshot && <>
      <fieldset className="user-project-options" disabled={busy}><legend>Selecciona los proyectos permitidos</legend>{snapshot.projects.map(p => <label key={p.projectId}><input type="checkbox" checked={selected.includes(p.projectId)} onChange={e => setSelected(current => e.target.checked ? [...current, p.projectId] : current.filter(id => id !== p.projectId))} /><span>{p.icon} {p.name}{p.leadsProject && <small>Líder del proyecto</small>}</span></label>)}</fieldset>
      {dirty && <div className="user-access-summary" aria-label="Resumen de cambios"><h3>Resumen antes de guardar</h3>{added.map(p => <p key={p.projectId}>Añadir acceso a <strong>{p.name}</strong>.</p>)}{removed.map(p => <div className="user-removal" key={p.projectId}><p>Retirar acceso a <strong>{p.name}</strong> y sus equipos internos.</p>{!!(p.leadsProject || p.tasks || p.modules || p.features) && <><p className="field-hint"><ArrowRightLeft size={14} />Reasignar: {p.leadsProject ? "liderazgo del proyecto; " : ""}{p.tasks} {p.tasks === 1 ? "tarea" : "tareas"}, {p.modules} {p.modules === 1 ? "módulo" : "módulos"} y {p.features} {p.features === 1 ? "feature" : "features"}, incluidas tareas terminadas y archivadas.</p><label htmlFor={`replacement-${p.projectId}`}>Nuevo responsable en {p.name}</label><select id={`replacement-${p.projectId}`} disabled={busy} value={replacements[p.projectId] ?? ""} onChange={e => setReplacements(current => ({ ...current, [p.projectId]: e.target.value }))}><option value="">Seleccionar reemplazo…</option>{p.candidates.map(c => <option key={c.id} value={c.id}>{c.name} · {c.email}</option>)}</select>{!p.candidates.length && <p className="form-error">Primero asigna otra persona a este proyecto.</p>}</>}</div>)}</div>}
    </>}
    </div>
    <div className="user-access-actions"><span className="user-access-save-hint" role="status">{dirty ? `${added.length + removed.length} ${(added.length + removed.length) === 1 ? "cambio por guardar" : "cambios por guardar"}` : "Sin cambios pendientes"}</span><Button variant="outline" disabled={busy || !snapshot || !dirty} onClick={() => { if (snapshot) { setSelected(snapshot.user.projectAccess.map(a => a.projectId)); setReplacements({}); } }}>Cancelar cambios</Button><Button disabled={busy || !snapshot || snapshot.user.role === "admin" || !dirty || needsReplacement} onClick={save}>{busy ? "Guardando…" : "Guardar accesos"}</Button></div>
    </DialogContent>
    {leaveDialog}
  </Dialog>;
}
