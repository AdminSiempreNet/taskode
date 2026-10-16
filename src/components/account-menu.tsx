"use client";
import {
  ChevronsUpDown,
  UserRound,
  Upload,
  Settings2,
  DatabaseBackup,
  Users,
  LogOut,
  ExternalLink,
} from "lucide-react";
import { authClient } from "@/lib/auth-client";
import type { CurrentUser } from "@/lib/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
export function AccountMenu({
  user,
  busy,
  onProfile,
  onImport,
  onSettings,
  onBackup,
  onUsers,
}: {
  user: CurrentUser;
  busy: boolean;
  onProfile: () => void;
  onImport: () => void;
  onSettings: () => void;
  onBackup: () => void;
  onUsers: () => void;
}) {
  const action = (fn: () => void) => () => setTimeout(fn, 0);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="account-trigger"
          disabled={busy}
          aria-label="Menú de usuario"
        >
          <Avatar user={user} />
          <span className="account-trigger-text">
            <strong>{user.name}</strong>
            <small>{user.email}</small>
          </span>
          <ChevronsUpDown size={16} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        className="account-dropdown"
      >
        <DropdownMenuLabel>
          {user.role === "admin" ? "Administrador" : "Mi cuenta"}
        </DropdownMenuLabel>
        <DropdownMenuItem onSelect={action(onProfile)}>
          <UserRound />
          Mi perfil
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={action(onImport)}>
          <Upload />
          Importar Trello
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={action(onSettings)}>
          <Settings2 />
          Configuración
        </DropdownMenuItem>
        {user.role === "admin" && (
          <>
            <DropdownMenuItem onSelect={action(onUsers)}>
              <Users />
              Usuarios e invitaciones
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={action(onBackup)}>
              <DatabaseBackup />
              Respaldo
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={async () => {
            await authClient.signOut();
            window.location.assign("/login");
          }}
        >
          <LogOut />
          Cerrar sesión
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
export function Avatar({
  user,
}: {
  user: Pick<CurrentUser, "name" | "image">;
}) {
  return (
    <span className="account-avatar">
      {user.image ? (
        <img src={user.image} alt="" referrerPolicy="no-referrer" />
      ) : (
        <span>{user.name.slice(0, 2).toLocaleUpperCase("es")}</span>
      )}
    </span>
  );
}
export function ProfileModal({
  user,
  close,
}: {
  user: CurrentUser;
  close: () => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent className="profile-dialog">
        <DialogTitle>Mi perfil</DialogTitle>
        <DialogDescription>
          Datos de tu cuenta y acceso a tus proveedores de identidad.
        </DialogDescription>
        <div className="profile-heading">
          <Avatar user={user} />
          <div>
            <strong>{user.name}</strong>
            <p>{user.email}</p>
          </div>
        </div>
        <dl className="profile-data">
          <dt>Rol</dt>
          <dd>{user.role === "admin" ? "Administrador" : "Usuario"}</dd>
          <dt>Fecha de registro</dt>
          <dd>
            {new Date(user.createdAt).toLocaleDateString("es-CO", {
              timeZone: "America/Bogota",
            })}
          </dd>
          <dt>Acceso con</dt>
          <dd>
            {user.providers
              .map((p) =>
                p === "google" ? "Google" : p === "github" ? "GitHub" : p,
              )
              .join(", ")}
          </dd>
        </dl>
        <p className="muted">
          El nombre y la foto se obtienen de tu proveedor. Puedes gestionar tu
          cuenta desde estos enlaces:
        </p>
        <div className="profile-links">
          {user.providers.includes("google") && (
            <a
              href="https://myaccount.google.com/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Gestionar mi cuenta de Google
              <ExternalLink size={15} />
            </a>
          )}
          {user.providers.includes("github") && (
            <a
              href="https://github.com/settings/profile"
              target="_blank"
              rel="noopener noreferrer"
            >
              Gestionar mi cuenta de GitHub
              <ExternalLink size={15} />
            </a>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
