"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Copy, Send, RefreshCw, X, Users } from "lucide-react";
import { toast } from "sonner";
import type { Project } from "@/lib/types";
import { fetchJSON } from "@/lib/http-client";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
type Invitation = {
  id: string;
  email: string;
  url: string;
  expiresAt: number;
  acceptedAt: number | null;
  revokedAt: number | null;
  deliveryStatus: string;
};
type User = { id: string; name: string; email: string; role: string };
export function InvitationManager({
  projects,
  defaultProjectId,
}: {
  projects: Project[];
  defaultProjectId?: string;
}) {
  const [invitations, setInvitations] = useState<Invitation[]>([]),
    [email, setEmail] = useState(""),
    [selected, setSelected] = useState<string[]>(
      defaultProjectId ? [defaultProjectId] : [],
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const reload = useCallback(async () => {
    try {
      setInvitations(
        (await fetchJSON<{ invitations: Invitation[] }>("/api/invitations"))
          .invitations,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar.");
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  async function send(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await fetchJSON<{ deliveryError: string | null }>(
        "/api/invitations",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, projectIds: selected }),
        },
      );
      setEmail("");
      await reload();
      if (result.deliveryError) {
        setError(
          `La invitación está lista para copiar. No se pudo enviar: ${result.deliveryError}`,
        );
      } else toast.success("Invitación enviada.");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "No se pudo crear la invitación.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function change(invitation: Invitation, method: "POST" | "DELETE") {
    setBusy(true);
    setError("");
    try {
      const data = await fetchJSON<{ deliveryError?: string }>(
        `/api/invitations/${invitation.id}`,
        { method },
      );
      await reload();
      if (data?.deliveryError)
        setError(
          `Puedes copiar el enlace. No se pudo enviar: ${data.deliveryError}`,
        );
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo actualizar.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="invitation-manager">
      <form onSubmit={send} className="form-stack">
        <label htmlFor="invite-email">
          Correo de la cuenta de Google o GitHub
        </label>
        <div className="invite-input-row">
          <Input
            id="invite-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="persona@empresa.com"
          />
          <Button type="submit" disabled={busy}>
            <Send size={16} />
            Invitar
          </Button>
        </div>
        {projects.length > 0 && (
          <fieldset className="invite-projects">
            <legend>Proyectos a los que tendrá acceso</legend>
            {projects.map((p) => (
              <label key={p.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(p.id)}
                  onChange={(e) =>
                    setSelected((current) =>
                      e.target.checked
                        ? [...current, p.id]
                        : current.filter((id) => id !== p.id),
                    )
                  }
                />
                {p.icon} {p.name}
              </label>
            ))}
          </fieldset>
        )}
        <p className="muted">
          La invitación vence en 7 días. Puedes enviar el correo o compartir el
          mismo enlace.
        </p>
      </form>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="invitation-list">
        {invitations.length === 0 ? (
          <p className="muted">Todavía no hay invitaciones.</p>
        ) : (
          invitations.map((invitation) => {
            const active =
              !invitation.acceptedAt &&
              !invitation.revokedAt &&
              invitation.expiresAt > Date.now();
            const status = invitation.acceptedAt
              ? "Aceptada"
              : invitation.revokedAt
                ? "Revocada"
                : !active
                  ? "Vencida"
                  : invitation.deliveryStatus === "sent"
                    ? "Correo enviado"
                    : "Lista para copiar";
            return (
              <article className="invitation-row" key={invitation.id}>
                <div>
                  <strong>{invitation.email}</strong>
                  <small>
                    {status} ·{" "}
                    {new Date(invitation.expiresAt).toLocaleDateString("es-CO")}
                  </small>
                </div>
                <div className="invite-row-actions">
                  {active && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(invitation.url);
                          toast.success("Enlace copiado.");
                        } catch {
                          setError(
                            "No se pudo copiar automáticamente. Selecciona y copia el enlace que aparece debajo.",
                          );
                        }
                      }}
                    >
                      <Copy size={14} />
                      Copiar enlace
                    </Button>
                  )}
                  {!invitation.acceptedAt && (
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={busy}
                      title="Reenviar con un nuevo enlace"
                      aria-label={`Reenviar invitación a ${invitation.email}`}
                      onClick={() => change(invitation, "POST")}
                    >
                      <RefreshCw size={15} />
                    </Button>
                  )}
                  {active && (
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={busy}
                      title="Revocar invitación"
                      aria-label={`Revocar invitación de ${invitation.email}`}
                      onClick={() => change(invitation, "DELETE")}
                    >
                      <X size={15} />
                    </Button>
                  )}
                </div>
                {active && (
                  <Input
                    className="invite-link"
                    value={invitation.url}
                    readOnly
                    aria-label={`Enlace para ${invitation.email}`}
                    onFocus={(e) => e.target.select()}
                  />
                )}
              </article>
            );
          })
        )}
      </div>
    </div>
  );
}
export function UsersModal({
  projects,
  projectId,
  close,
}: {
  projects: Project[];
  projectId?: string;
  close: () => void;
}) {
  const [users, setUsers] = useState<User[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    fetchJSON<{ users: User[] }>("/api/users")
      .then((data) => setUsers(data.users))
      .catch((e) => setError(e.message));
  }, []);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent className="people-dialog">
        <DialogTitle>
          <Users size={19} /> Usuarios e invitaciones
        </DialogTitle>
        <DialogDescription>
          Invita a las personas que podrán acceder a este espacio.
        </DialogDescription>
        <div className="people-scroll">
          <h3>Usuarios registrados</h3>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          <div className="people-list">
            {users.map((u) => (
              <div key={u.id}>
                <span>
                  <strong>{u.name}</strong>
                  <small>{u.email}</small>
                </span>
                <span className="role-badge">
                  {u.role === "admin" ? "Administrador" : "Usuario"}
                </span>
              </div>
            ))}
          </div>
          <h3>Invitaciones</h3>
          <InvitationManager projects={projects} defaultProjectId={projectId} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
