"use client";
import { useState } from "react";
import { Loader2, LockKeyhole } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { IDENTITY_SCOPES, scopeLabel } from "@/lib/oauth-scopes";
import type { OAuthClientView } from "@/server/oauth-ui";
import { OAuthClientBadge } from "./auth-screen";
import { TaskodeBrand } from "./taskode-brand";
import { Button } from "./ui/button";

const ADMIN_SCOPE = "taskode:admin";
export function OAuthConsent({
  client,
  scopes,
  isAdmin,
  account,
}: {
  client: OAuthClientView;
  scopes: string[];
  isAdmin: boolean;
  account: string;
}) {
  // Least privilege: the administrative scope is opt-in and only for the administrator.
  const [admin, setAdmin] = useState(false),
    [pending, setPending] = useState<"" | "accept" | "deny">(""),
    [message, setMessage] = useState("");
  const capabilities = scopes.filter((scope) => !IDENTITY_SCOPES.has(scope));
  async function decide(accept: boolean) {
    setPending(accept ? "accept" : "deny");
    setMessage("");
    try {
      const granted = scopes.filter((scope) => scope !== ADMIN_SCOPE || (isAdmin && admin));
      const result = await authClient.oauth2.consent({
        accept,
        ...(accept ? { scope: granted.join(" ") } : {}),
      });
      if (result.error) throw new Error(result.error.message || "No se pudo completar la autorización.");
      const url = (result.data as { url?: string } | null)?.url;
      if (!url) throw new Error("La aplicación no indicó adónde volver.");
      window.location.assign(url);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "No se pudo completar la autorización.");
      setPending("");
    }
  }
  return (
    <main className="auth-shell oauth-consent-shell">
      <section className="auth-card auth-message-card oauth-consent" aria-labelledby="consent-title">
        <TaskodeBrand />
        <h1 id="consent-title">{client.name} quiere acceder a Taskode</h1>
        <OAuthClientBadge client={client} />
        <p>
          Actuará como <strong>{account}</strong>, con tus mismos permisos en
          cada proyecto.
        </p>
        <ul className="oauth-scopes">
          {capabilities.map((scope) => {
            const label = scopeLabel(scope);
            if (scope === ADMIN_SCOPE)
              return (
                <li key={scope}>
                  <label className={isAdmin ? "" : "oauth-scope-disabled"}>
                    <input
                      type="checkbox"
                      checked={isAdmin && admin}
                      disabled={!isAdmin || Boolean(pending)}
                      onChange={(event) => setAdmin(event.target.checked)}
                    />
                    <span>
                      <strong>{label.title}</strong>
                      {isAdmin ? label.description : "No aplica a tu cuenta."}
                    </span>
                  </label>
                </li>
              );
            return (
              <li key={scope}>
                <span>
                  <strong>{label.title}</strong>
                  {label.description}
                </span>
              </li>
            );
          })}
        </ul>
        {message && (
          <p className="form-error" role="alert">
            {message}
          </p>
        )}
        <div className="oauth-consent-actions">
          <Button variant="outline" disabled={Boolean(pending)} onClick={() => decide(false)}>
            {pending === "deny" && <Loader2 className="animate-spin" aria-hidden="true" />}
            Cancelar
          </Button>
          <Button disabled={Boolean(pending)} onClick={() => decide(true)}>
            {pending === "accept" && <Loader2 className="animate-spin" aria-hidden="true" />}
            Permitir
          </Button>
        </div>
        <div className="auth-access-note">
          <LockKeyhole size={14} aria-hidden="true" />
          <p className="auth-note">
            Puedes revocar el acceso cuando quieras desde Mi perfil →
            Aplicaciones conectadas.
          </p>
        </div>
      </section>
    </main>
  );
}
