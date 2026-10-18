"use client";
import { useState } from "react";
import { Loader2, Users, X } from "lucide-react";
import type { ProjectPerson, UserSummary } from "@/lib/types";
import { SearchCombobox } from "./search-combobox";
import { Button } from "./ui/button";
import { UserAvatar } from "./user-avatar";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";

export function TaskAssignments({
  people,
  leaderId,
  teamMemberIds,
  onSave,
  busy,
  canManage,
  isNew = false,
}: {
  people: ProjectPerson[];
  leaderId: string;
  teamMemberIds: string[];
  onSave: (leaderId: string, teamMemberIds: string[]) => Promise<boolean>;
  busy: boolean;
  canManage: boolean;
  isNew?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draftLeader, setDraftLeader] = useState(leaderId);
  const [draftTeamMembers, setDraftTeamMembers] = useState(teamMemberIds);
  const [saving, setSaving] = useState(false);
  const waiting = busy || saving;
  const leader = people.find((person) => person.id === leaderId);
  const teamMembers = [...new Set(teamMemberIds)].filter(
    (id) => id !== leaderId,
  );
  const personTitle = (person?: ProjectPerson) =>
    person ? `${person.name} · ${person.email}` : "Usuario no disponible";

  function changeOpen(next: boolean) {
    if (waiting) return;
    if (next) {
      setDraftLeader(leaderId);
      setDraftTeamMembers(teamMembers);
    }
    setOpen(next);
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <div className="task-assignment-control">
        <div className="task-assignment-avatars">
          <span
            className="task-assignment-leader"
            role="img"
            aria-label={`Líder: ${leader?.name ?? "sin asignar"}`}
            title={`Líder: ${personTitle(leader)}`}
          >
            <UserAvatar
              name={leader?.name ?? "Usuario"}
              image={leader?.image}
            />
          </span>
          {teamMembers.length > 0 && (
            <div
              className="task-assignment-team"
              role="group"
              aria-label={`Equipo: ${teamMembers.length}`}
              title={teamMembers
                .map((id) =>
                  personTitle(people.find((person) => person.id === id)),
                )
                .join("\n")}
            >
              {teamMembers.slice(0, 3).map((id) => {
                const person = people.find((person) => person.id === id);
                return (
                  <span
                    key={id}
                    role="img"
                    aria-label={`Miembro del equipo: ${person?.name ?? "no disponible"}`}
                    title={personTitle(person)}
                  >
                    <UserAvatar
                      name={person?.name ?? "Usuario"}
                      image={person?.image}
                    />
                  </span>
                );
              })}
            </div>
          )}
        </div>
        <DialogTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className="task-assignment-trigger"
            aria-label="Ver asignación de usuarios"
            title={`Ver asignación: ${teamMembers.length} miembros del equipo`}
            disabled={waiting}
          >
            <Users size={16} />
            Usuarios
          </Button>
        </DialogTrigger>
      </div>
      <DialogContent
        className="task-assignment-dialog"
        onEscapeKeyDown={(event) => {
          if (waiting) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (waiting) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Asignación de usuarios</DialogTitle>
          <DialogDescription>
            {canManage
              ? isNew
                ? "Elige el líder y los miembros del equipo para la nueva tarea."
                : "Los cambios se guardan al aceptar."
              : "Consulta el líder y los miembros del equipo de esta tarea."}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (waiting || !canManage) return;
            const changed =
              draftLeader !== leaderId ||
              JSON.stringify([...draftTeamMembers].sort()) !==
                JSON.stringify([...teamMembers].sort());
            if (!changed) {
              setOpen(false);
              return;
            }
            setSaving(true);
            try {
              if (await onSave(draftLeader, draftTeamMembers)) setOpen(false);
            } finally {
              setSaving(false);
            }
          }}
        >
          <TaskPeopleFields
            people={people}
            leaderId={draftLeader}
            teamMemberIds={draftTeamMembers}
            onLeader={(id) => {
              setDraftLeader(id);
              setDraftTeamMembers((ids) => ids.filter((value) => value !== id));
            }}
            onTeamMembers={setDraftTeamMembers}
            disabled={waiting || !canManage}
            idPrefix="task-assignment"
            framed={false}
          />
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={waiting}>
                {canManage ? "Cancelar" : "Cerrar"}
              </Button>
            </DialogClose>
            {canManage && (
              <Button type="submit" disabled={waiting || !draftLeader}>
                {saving && <Loader2 size={16} className="animate-spin" />}
                {saving ? "Guardando…" : "Aceptar"}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function TaskPeopleFields({
  people,
  leaderId,
  teamMemberIds,
  onLeader,
  onTeamMembers,
  disabled,
  idPrefix = "task",
  framed = true,
}: {
  people: ProjectPerson[];
  leaderId: string;
  teamMemberIds: string[];
  onLeader: (id: string) => void;
  onTeamMembers: (ids: string[]) => void;
  disabled?: boolean;
  idPrefix?: string;
  framed?: boolean;
}) {
  const options = people.map((person) => ({
    ...person,
    secondary: person.email,
  }));
  return (
    <section
      className={framed ? "task-property-section" : undefined}
      aria-label="Usuarios"
    >
      {framed && <h2>Usuarios</h2>}
      <div className="task-people-fields">
        <div className="field">
          <label htmlFor={`${idPrefix}-leader`}>Líder</label>
          <SearchCombobox
            id={`${idPrefix}-leader`}
            label="Líder"
            placeholder="Selecciona líder"
            options={options}
            values={[leaderId]}
            onChange={(ids) => onLeader(ids[0])}
            disabled={disabled}
          />
        </div>
        <div className="field">
          <label htmlFor={`${idPrefix}-team`}>Equipo</label>
          <SearchCombobox
            id={`${idPrefix}-team`}
            label="Equipo"
            placeholder="Agregar al equipo…"
            options={options.filter((p) => p.id !== leaderId)}
            values={teamMemberIds}
            onChange={onTeamMembers}
            multiple
            disabled={disabled}
          />
          {teamMemberIds.some((id) => id !== leaderId) && (
            <ul
              className="task-client-list task-team-list"
              aria-label="Miembros del equipo"
            >
              {teamMemberIds
                .filter((id) => id !== leaderId)
                .map((id) => {
                  const person = people.find((person) => person.id === id);
                  return (
                    <li key={id}>
                      <div className="search-option-content">
                        <UserAvatar
                          name={person?.name ?? "Usuario"}
                          image={person?.image}
                        />
                        <div className="client-option-text">
                          <span>{person?.name ?? "Usuario no disponible"}</span>
                          {person?.email && <small>{person.email}</small>}
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={disabled}
                        aria-label={`Quitar del equipo a ${person?.name ?? "usuario no disponible"}`}
                        onClick={() =>
                          onTeamMembers(teamMemberIds.filter((x) => x !== id))
                        }
                      >
                        <X size={14} />
                      </Button>
                    </li>
                  );
                })}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
export function TaskPeopleSummary({
  leader,
  teamMembers = [],
}: {
  leader?: UserSummary;
  teamMembers?: UserSummary[];
}) {
  if (!leader) return null;
  return (
    <div className="task-people-summary">
      <span title="Líder">{leader.name}</span>
      {teamMembers.length > 0 && (
        <span title={teamMembers.map((c) => c.name).join(", ")}>
          +{teamMembers.length} en el equipo
        </span>
      )}
    </div>
  );
}
