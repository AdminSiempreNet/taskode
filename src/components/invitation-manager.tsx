"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { Copy, Send, RefreshCw, X, Mail, UserPlus, Info, Clock3, Search, SearchX, FolderClosed, ChevronDown, List, LayoutGrid } from "lucide-react";
import { toast } from "sonner";
import type { Project } from "@/lib/types";
import type { ManagedUser } from "@/lib/users";
import { fetchJSON } from "@/lib/http-client";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { useUnsavedChanges } from "./unsaved-changes";

type Invitation = {
  id: string; email: string; url: string; projectIds: string[]; expiresAt: number;
  acceptedAt: number | null; revokedAt: number | null; deliveryStatus: string;
};
type Result = { kind: "invitation"; invitation: Invitation } | { kind: "assigned"; userId: string; addedProjectIds: string[] };

function lifecycle(invitation: Invitation) {
  return invitation.acceptedAt ? "accepted" : invitation.revokedAt ? "revoked" : invitation.expiresAt <= Date.now() ? "expired" : "pending";
}

export function InvitationManager({ projects, defaultProjectId, onUpdated, onBusy, layout = "stacked", open = false, onOpenChange, restoreFocus }: {
  projects: Project[]; defaultProjectId?: string; onUpdated?: () => void; onBusy?: (busy: boolean) => void;
  layout?: "stacked" | "directory"; open?: boolean; onOpenChange?: (open: boolean) => void; restoreFocus?: () => void;
}) {
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [email, setEmail] = useState("");
  const [selected, setSelected] = useState<string[]>(defaultProjectId ? [defaultProjectId] : []);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [formError, setFormError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState<"list" | "grid">("list");
  const [query, setQuery] = useState(""), [projectFilter, setProjectFilter] = useState(""), [statusFilter, setStatusFilter] = useState("");
  const [copyFallback, setCopyFallback] = useState<string | null>(null);
  const directory = layout === "directory";
  const projectSelectionChanged = defaultProjectId ? selected.length !== 1 || selected[0] !== defaultProjectId : selected.length > 0;
  const dirty = !!email.trim() || projectSelectionChanged;
  const { requestNavigation, leaveDialog } = useUnsavedChanges(dirty && (!directory || open), busy, "formulario de invitación");
  useEffect(() => { onBusy?.(busy); }, [busy, onBusy]);
  useEffect(() => () => { onBusy?.(false); }, [onBusy]);
  const known = users.find(u => u.email.toLowerCase() === email.trim().toLowerCase());
  const reload = useCallback(async () => {
    try {
      const [data, people] = await Promise.all([
        fetchJSON<{ invitations: Invitation[] }>("/api/invitations"),
        fetchJSON<{ users: ManagedUser[] }>("/api/users"),
      ]);
      setInvitations(data.invitations); setUsers(people.users); setError(""); setLoaded(true);
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo cargar."); }
  }, []);
  useEffect(() => {
    void reload();
    const refresh = () => { if (document.visibilityState === "visible") void reload(); };
    window.addEventListener("focus", refresh);
    const timer = setInterval(refresh, 30000);
    return () => { window.removeEventListener("focus", refresh); clearInterval(timer); };
  }, [reload]);
  function resetForm() {
    setEmail(""); setSelected(defaultProjectId ? [defaultProjectId] : []); setFormError("");
  }
  function requestClose() {
    if (!busy) requestNavigation(() => { resetForm(); onOpenChange?.(false); });
  }
  async function send(event: FormEvent) {
    event.preventDefault();
    if (busy || !loaded) return;
    setBusy(true); setFormError("");
    let completed = false;
    try {
      const result = await fetchJSON<Result>("/api/invitations", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, projectIds: selected }),
      });
      resetForm();
      await reload(); onUpdated?.();
      toast.success(result.kind === "assigned" ? result.addedProjectIds.length ? "Proyectos asignados. La persona recibirá los avisos." : "La persona ya tenía acceso a los proyectos seleccionados." : "Invitación creada. El correo está en cola y puedes copiar el enlace.");
      completed = true;
    } catch (e) { setFormError(e instanceof Error ? e.message : "No se pudo completar la operación."); }
    finally {
      setBusy(false);
      if (completed) { onBusy?.(false); onOpenChange?.(false); }
    }
  }
  async function change(invitation: Invitation, method: "POST" | "DELETE") {
    if (busy) return;
    setBusy(true); setError("");
    try {
      await fetchJSON(`/api/invitations/${encodeURIComponent(invitation.id)}`, { method });
      await reload(); onUpdated?.();
      toast.success(method === "DELETE" ? "Invitación revocada." : "Nuevo enlace creado. El correo está en cola.");
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo actualizar."); }
    finally { setBusy(false); }
  }
  async function copy(invitation: Invitation) {
    try { await navigator.clipboard.writeText(invitation.url); setCopyFallback(null); toast.success("Enlace copiado."); }
    catch { setCopyFallback(invitation.id); setError("No se pudo copiar automáticamente. Selecciona y copia el enlace de la invitación."); }
  }
  function status(invitation: Invitation) {
    const state = lifecycle(invitation);
    const existing = users.some(u => u.email.toLowerCase() === invitation.email.toLowerCase());
    const text = state === "accepted" ? "Aceptada" : state === "revoked" ? "Revocada" : state === "expired" ? "Vencida" : existing ? "Usuario registrado" : invitation.deliveryStatus === "sent" ? "Correo enviado" : invitation.deliveryStatus === "failed" ? "No se pudo enviar; se reintentará" : "Correo en cola";
    const kind = state !== "pending" ? state : existing ? "registered" : invitation.deliveryStatus === "sent" ? "sent" : invitation.deliveryStatus === "failed" ? "failed" : "pending";
    return <span className="invitation-status" data-status={kind}>{text}</span>;
  }
  function projectChips(invitation: Invitation) {
    return <div className="user-project-chips">{invitation.projectIds.length ? <>
      {invitation.projectIds.slice(0, 2).map(id => {
        const project = projects.find(p => p.id === id);
        return <span key={id} title={project?.name ?? "Proyecto eliminado"}><span className="user-project-name">{project?.icon} {project?.name ?? "Proyecto eliminado"}</span></span>;
      })}
      {invitation.projectIds.length > 2 && <span title={invitation.projectIds.slice(2).map(id => projects.find(p => p.id === id)?.name ?? "Proyecto eliminado").join(", ")}>+{invitation.projectIds.length - 2}</span>}
    </> : <small className="user-no-projects">Sin proyectos asignados</small>}</div>;
  }
  function actions(invitation: Invitation, card = false) {
    const active = lifecycle(invitation) === "pending";
    const existing = users.find(u => u.email.toLowerCase() === invitation.email.toLowerCase());
    return <div className="invite-row-actions">
      {active && <Button variant={card ? "outline" : "ghost"} size={card ? "sm" : "icon-sm"} disabled={busy} aria-label={`Copiar enlace de ${invitation.email}`} title="Copiar enlace" onClick={() => void copy(invitation)}><Copy size={14} />{card && "Copiar enlace"}</Button>}
      {!invitation.acceptedAt && (existing ? <Link className="users-text-link" href={`/users?user=${encodeURIComponent(existing.id)}`}>Gestionar usuario</Link> : <Button variant="ghost" size="icon-sm" disabled={busy} aria-label={`Reenviar invitación a ${invitation.email}`} title="Reenviar con un nuevo enlace" onClick={() => void change(invitation, "POST")}><RefreshCw size={14} /></Button>)}
      {active && <Button variant="ghost" size="icon-sm" disabled={busy} aria-label={`Revocar invitación de ${invitation.email}`} title="Revocar invitación" onClick={() => void change(invitation, "DELETE")}><X size={15} /></Button>}
      {!active && invitation.acceptedAt && <span className="invitation-completed">Invitación aceptada</span>}
    </div>;
  }
  function fallbackLink(invitation: Invitation) {
    return (copyFallback === invitation.id || !directory) && lifecycle(invitation) === "pending" ? <Input className="invite-link" value={invitation.url} readOnly aria-label={`Enlace para ${invitation.email}`} onFocus={e => e.target.select()} /> : null;
  }
  const submitButton = <Button type="submit" disabled={busy || !loaded || (!!known && !selected.length)}><Send size={16} aria-hidden="true" />{busy ? "Procesando…" : known ? "Asignar proyectos" : "Invitar"}</Button>;
  const fields = <>
    <div className="invitation-email-field">
      <label htmlFor="invite-email">Correo de la cuenta de Google o GitHub</label>
      <div className="invite-input-row"><Input id="invite-email" type="email" required value={email} disabled={busy} onChange={e => setEmail(e.target.value)} placeholder="persona@empresa.com" />{!directory && submitButton}</div>
    </div>
    {(known || directory) && <p className="users-notice invite-recipient-status" role="status"><Info size={16} aria-hidden="true" /><span>{known ? `${known.name} ya está registrado. Se añadirán los proyectos elegidos a sus accesos actuales.` : "Si la persona ya tiene una cuenta, los proyectos se asignarán directamente."}</span></p>}
    {!!projects.length && <fieldset className="invite-projects" disabled={busy}>
      <legend>Proyectos a los que tendrá acceso</legend>
      {projects.map(p => <label key={p.id}><input type="checkbox" checked={selected.includes(p.id)} onChange={e => setSelected(current => e.target.checked ? [...current, p.id] : current.filter(id => id !== p.id))} /><span className="invite-project-name" title={p.name}>{p.icon} {p.name}</span><small className="invite-project-access">{known?.projectAccess.some(a => a.projectId === p.id) ? "Ya tiene acceso" : ""}</small></label>)}
    </fieldset>}
    {!loaded && <p role={error ? "alert" : "status"} className={error ? "form-error" : "muted"}>{error || "Preparando el formulario…"}{error && <Button type="button" variant="ghost" onClick={reload}>Reintentar</Button>}</p>}
    {formError && <p className="form-error" role="alert">{formError}</p>}
  </>;
  const filtered = invitations.filter(invitation => invitation.email.toLowerCase().includes(query.trim().toLowerCase()) && (!projectFilter || invitation.projectIds.includes(projectFilter)) && (!statusFilter || lifecycle(invitation) === statusFilter));
  const hasFilters = !!(query || projectFilter || statusFilter);
  const expiry = (invitation: Invitation) => new Date(invitation.expiresAt).toLocaleDateString("es-CO", { timeZone: "America/Bogota" });

  if (!directory) return <div className="invitation-manager">
    <form onSubmit={send} className="form-stack">{fields}<p className="muted">La invitación vence en 7 días. Puedes compartir el enlace mientras se envía el correo.</p></form>
    {error && <p className="form-error" role="alert">{error} <Button variant="ghost" onClick={reload}>Reintentar</Button></p>}
    <section aria-label="Invitaciones enviadas" className="invitation-list">
      {!loaded && !error && <p role="status">Cargando invitaciones…</p>}
      {loaded && !invitations.length && <p className="muted">Todavía no hay invitaciones.</p>}
      {invitations.map(invitation => <article className="invitation-row" key={invitation.id}><div><strong>{invitation.email}</strong>{status(invitation)}<small>Vence {expiry(invitation)}</small>{projectChips(invitation)}</div>{actions(invitation, true)}{fallbackLink(invitation)}</article>)}
    </section>{leaveDialog}
  </div>;

  return <>
    <section className="users-panel invitations-panel" aria-label="Invitaciones enviadas">
      <div className="users-panel-heading"><div><h2>Invitaciones enviadas</h2><p>Consulta los proyectos, enlaces y el estado de cada invitación.</p></div><span className="users-total">{loaded ? invitations.length : "—"}</span></div>
      <div className="users-filters">
        <div className="search-field"><Search size={16} aria-hidden="true" /><Input aria-label="Buscar invitaciones" placeholder="Buscar por correo…" value={query} onChange={e => setQuery(e.target.value)} />{query && <button className="users-search-clear" aria-label="Limpiar búsqueda de invitaciones" onClick={() => setQuery("")}><X size={14} /></button>}</div>
        <div className="users-filter-select"><FolderClosed size={15} aria-hidden="true" /><select aria-label="Filtrar invitaciones por proyecto" value={projectFilter} onChange={e => setProjectFilter(e.target.value)}><option value="">Todos los proyectos</option>{projects.map(p => <option key={p.id} value={p.id}>{p.icon} {p.name}</option>)}</select><ChevronDown size={13} aria-hidden="true" /></div>
        <div className="users-filter-select users-role-filter"><Clock3 size={15} aria-hidden="true" /><select aria-label="Filtrar invitaciones por estado" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}><option value="">Todos los estados</option><option value="pending">Pendientes</option><option value="accepted">Aceptadas</option><option value="revoked">Revocadas</option><option value="expired">Vencidas</option></select><ChevronDown size={13} aria-hidden="true" /></div>
        <div className="users-view-toggle" role="group" aria-label="Vista de invitaciones"><button aria-label="Vista de lista" aria-pressed={view === "list"} onClick={() => setView("list")} title="Vista de lista"><List size={16} /></button><button aria-label="Vista de tarjetas" aria-pressed={view === "grid"} onClick={() => setView("grid")} title="Vista de tarjetas"><LayoutGrid size={16} /></button></div>
      </div>
      {error && <p className="form-error" role="alert">{error} <Button variant="ghost" onClick={reload}>Reintentar</Button></p>}
      {!loaded && !error && <p className="sr-only" role="status">Cargando invitaciones…</p>}
      <div className={`users-directory${view === "grid" ? " users-directory-grid" : ""}`} aria-label="Directorio de invitaciones" aria-busy={!loaded}>
        {!loaded && !error ? <div className="users-loading" aria-hidden="true">{Array.from({ length: 3 }, (_, i) => <div className="user-row-skeleton" key={i}><span /><span /><span /></div>)}</div> : !loaded ? null : !filtered.length ? <div className="users-empty">
          <span className="users-empty-icon">{hasFilters ? <SearchX size={25} /> : <Mail size={25} />}</span><h3>{hasFilters ? "No encontramos coincidencias" : "Todo listo para sumar al equipo"}</h3>
          <p>{hasFilters ? "Prueba con otro correo, proyecto o estado." : "Todavía no hay invitaciones. Invita a tu equipo para comenzar."}</p>
          {hasFilters ? <Button variant="outline" size="sm" onClick={() => { setQuery(""); setProjectFilter(""); setStatusFilter(""); }}>Limpiar filtros</Button> : <Button size="sm" disabled={busy} onClick={() => onOpenChange?.(true)}><UserPlus size={15} />Nueva invitación</Button>}
        </div> : view === "list" ? <table className="users-table invitations-table">
          <caption className="sr-only">Invitaciones, proyectos y estado de acceso</caption><thead><tr><th scope="col">Persona invitada</th><th scope="col">Estado</th><th scope="col">Proyectos</th><th scope="col">Vencimiento</th><th scope="col" className="users-actions-heading">Acciones</th></tr></thead>
          <tbody>{filtered.map(invitation => <tr className="user-row invitation-record" key={invitation.id}>
            <td><div className="invitation-person"><span className="invitation-avatar"><Mail size={16} aria-hidden="true" /></span><div><h3 title={invitation.email}>{invitation.email}</h3>{fallbackLink(invitation)}</div></div></td>
            <td data-label="Estado">{status(invitation)}</td><td data-label="Proyectos">{projectChips(invitation)}</td><td data-label="Vence"><span className="invitation-expiration">{expiry(invitation)}</span></td><td className="user-row-action">{actions(invitation)}</td>
          </tr>)}</tbody>
        </table> : filtered.map(invitation => <article className="user-card invitation-record invitation-card" key={invitation.id}>
          <div className="invitation-person"><span className="invitation-avatar"><Mail size={17} aria-hidden="true" /></span><h3 title={invitation.email}>{invitation.email}</h3></div>
          {status(invitation)}<div className="user-card-projects"><span className="user-card-label">Proyectos</span>{projectChips(invitation)}</div>
          <p className="invitation-expiration"><Clock3 size={12} aria-hidden="true" />Vence el {expiry(invitation)}</p><div className="user-card-action">{actions(invitation, true)}</div>{fallbackLink(invitation)}
        </article>)}
      </div>
      <footer className="users-directory-footer"><span role="status">{loaded ? hasFilters ? `${filtered.length} de ${invitations.length} invitaciones` : `${invitations.length} ${invitations.length === 1 ? "invitación en el espacio" : "invitaciones en el espacio"}` : "Cargando invitaciones…"}</span><span><Clock3 size={13} aria-hidden="true" />Los enlaces de invitación son válidos durante 7 días.</span></footer>
    </section>
    <Dialog open={open} onOpenChange={next => { if (!next) requestClose(); }}>
      <DialogContent className="invitation-create-dialog" showCloseButton={false} onOpenAutoFocus={event => { event.preventDefault(); document.getElementById("invite-email")?.focus(); }} onCloseAutoFocus={event => { if (restoreFocus) { event.preventDefault(); restoreFocus(); } }} onEscapeKeyDown={event => { if (busy) event.preventDefault(); }}>
        <form onSubmit={send} className="invitation-create-form">
          <DialogHeader className="invitation-create-header"><div className="user-access-title"><span className="users-section-icon"><UserPlus size={20} aria-hidden="true" /></span><div><DialogTitle>Nueva invitación</DialogTitle><DialogDescription>Elige a quién invitar y qué proyectos compartir.</DialogDescription></div><Button type="button" variant="ghost" size="icon-sm" disabled={busy} aria-label="Cerrar invitación" onClick={requestClose}><X size={18} /></Button></div></DialogHeader>
          <div className="invitation-create-body" aria-busy={busy}>{fields}</div>
          <footer className="invitation-create-footer"><p><Clock3 size={13} aria-hidden="true" />El enlace es válido durante 7 días. Podrás copiarlo desde el listado.</p><div><Button type="button" variant="outline" disabled={busy} onClick={requestClose}>Cancelar</Button>{submitButton}</div></footer>
        </form>
      </DialogContent>
    </Dialog>
    {leaveDialog}
  </>;
}
