"use client";
import { useCallback, useEffect, useState } from "react";
import { Users, UserPlus, UserRoundCog, X } from "lucide-react";
import type { CurrentUser, Project } from "@/lib/types";
import { fetchJSON } from "@/lib/http-client";
import type { Mutate } from "./forms";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
type User = { id: string; name: string; email: string; role: string };
export function ProjectPeopleModal({
  project,
  currentUser,
  mutate,
  close,
}: {
  project: Project;
  currentUser: CurrentUser;
  mutate: Mutate;
  close: () => void;
}) {
  const [users, setUsers] = useState<User[]>([]),
    [members, setMembers] = useState<string[]>([]),
    [selected, setSelected] = useState(""),
    [owner, setOwner] = useState(project.ownerId),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const reload = useCallback(async () => {
    try {
      const data = await fetchJSON<{ users: User[]; members: string[] }>(
        `/api/users?projectId=${encodeURIComponent(project.id)}`,
      );
      setUsers(data.users);
      setMembers(data.members);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar.");
    }
  }, [project.id]);
  useEffect(() => {
    void reload();
  }, [reload]);
  useEffect(() => {
    setOwner(project.ownerId);
    if (currentUser.role !== "admin" && project.ownerId !== currentUser.id)
      close();
  }, [project.ownerId, currentUser, close]);
  async function change(
    type:
      | "project.member.add"
      | "project.member.remove"
      | "project.transferOwnership",
    userId: string,
  ) {
    setBusy(true);
    try {
      const result = await mutate({
        type,
        id: project.id,
        projectId: project.id,
        userId,
      });
      if (result) {
        setSelected("");
        await reload();
      }
    } finally {
      setBusy(false);
    }
  }
  const available = users.filter(
    (u) => u.id !== project.ownerId && !members.includes(u.id),
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
    >
      <DialogContent className="people-dialog">
        <DialogTitle>
          <Users size={19} /> Participantes del proyecto
        </DialogTitle>
        <DialogDescription>
          {project.icon} {project.name}
        </DialogDescription>
        <div className="people-scroll">
          <h3>Propietario</h3>
          <p>
            {users.find((u) => u.id === project.ownerId)?.name || "Cargando…"}
          </p>
          {currentUser.role === "admin" && (
            <div className="ownership-control">
              <label htmlFor="project-owner">Cambiar propietario</label>
              <div className="invite-input-row">
                <select
                  id="project-owner"
                  value={owner}
                  onChange={(e) => setOwner(e.target.value)}
                >
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} · {u.email}
                    </option>
                  ))}
                </select>
                <Button
                  disabled={busy || owner === project.ownerId}
                  variant="outline"
                  onClick={() => change("project.transferOwnership", owner)}
                >
                  <UserRoundCog size={16} />
                  Cambiar
                </Button>
              </div>
              <p className="muted">
                El propietario anterior conservará acceso como participante.
              </p>
            </div>
          )}
          <h3>Participantes</h3>
          <div className="people-list">
            {users
              .filter((u) => members.includes(u.id) && u.id !== project.ownerId)
              .map((u) => (
                <div key={u.id}>
                  <span>
                    <strong>{u.name}</strong>
                    <small>{u.email}</small>
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={busy}
                    aria-label={`Quitar a ${u.name}`}
                    onClick={() => change("project.member.remove", u.id)}
                  >
                    <X size={16} />
                  </Button>
                </div>
              ))}
          </div>
          {members.filter((id) => id !== project.ownerId).length === 0 && (
            <p className="muted">Todavía no hay participantes adicionales.</p>
          )}
          <div className="invite-input-row">
            <select
              aria-label="Usuario para agregar al proyecto"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              <option value="">Selecciona un usuario registrado</option>
              {available.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} · {u.email}
                </option>
              ))}
            </select>
            <Button
              disabled={busy || !selected}
              onClick={() => change("project.member.add", selected)}
            >
              <UserPlus size={16} />
              Agregar
            </Button>
          </div>
          <p className="muted">
            El administrador puede invitar nuevas cuentas desde Usuarios e
            invitaciones.
          </p>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
