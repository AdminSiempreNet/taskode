"use client";
import { useEffect, useState } from "react";
import { Check, Copy, Loader2, PlugZap } from "lucide-react";
import { fetchJSON } from "@/lib/http-client";
import { IDENTITY_SCOPES, scopeLabel } from "@/lib/oauth-scopes";
import type { ConnectedApp } from "@/server/oauth-connections";
import { Button } from "./ui/button";

const date = (value: string) =>
  new Date(value).toLocaleDateString("es-CO", { timeZone: "America/Bogota" });
export function ConnectedApps() {
  const [apps, setApps] = useState<ConnectedApp[] | null>(null),
    [error, setError] = useState(""),
    [confirming, setConfirming] = useState(""),
    [revoking, setRevoking] = useState(""),
    [copied, setCopied] = useState(false);
  const endpoint = typeof window === "undefined" ? "" : `${window.location.origin}/api/mcp`;
  useEffect(() => {
    fetchJSON<{ connections: ConnectedApp[] }>("/api/oauth/connections")
      .then((data) => setApps(data.connections))
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudieron cargar las aplicaciones."));
  }, []);
  async function revoke(clientId: string) {
    setRevoking(clientId);
    setError("");
    try {
      await fetchJSON("/api/oauth/connections", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId }),
      });
      setApps((current) => current?.filter((app) => app.clientId !== clientId) ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo revocar el acceso.");
    } finally {
      setRevoking("");
      setConfirming("");
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(endpoint);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }
  return (
    <section className="connected-apps" aria-labelledby="connected-apps-title">
      <h3 id="connected-apps-title">
        <PlugZap size={16} aria-hidden="true" />
        Aplicaciones conectadas
      </h3>
      <p className="muted">
        Conecta asistentes compatibles con MCP (Claude, Cursor…) usando esta
        dirección. Actúan con tus mismos permisos.
      </p>
      <div className="connected-apps-endpoint">
        <code>{endpoint}</code>
        <Button variant="outline" size="sm" onClick={copy} aria-label="Copiar dirección MCP">
          {copied ? <Check /> : <Copy />}
          {copied ? "Copiada" : "Copiar"}
        </Button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {apps === null && !error ? (
        <p className="muted">
          <Loader2 className="animate-spin" size={14} aria-hidden="true" /> Cargando…
        </p>
      ) : apps?.length === 0 ? (
        <p className="muted">Aún no has conectado aplicaciones.</p>
      ) : (
        <ul>
          {apps?.map((app) => (
            <li key={app.clientId}>
              <div>
                <strong>{app.name}</strong>
                <small>
                  {app.verifiedHost ?? (app.dynamic ? "Registrada automáticamente" : "Registrada en Taskode")}
                  {" · "}Conectada el {date(app.connectedAt)}
                  {app.lastUsedAt ? ` · Último uso ${date(app.lastUsedAt)}` : ""}
                </small>
                <small>
                  {app.scopes
                    .filter((scope) => !IDENTITY_SCOPES.has(scope))
                    .map((scope) => scopeLabel(scope).title)
                    .join(" · ")}
                </small>
              </div>
              {confirming === app.clientId ? (
                <span className="connected-apps-confirm">
                  <Button variant="outline" size="sm" disabled={Boolean(revoking)} onClick={() => setConfirming("")}>
                    Cancelar
                  </Button>
                  <Button
                    size="sm"
                    className="destructive-button"
                    disabled={Boolean(revoking)}
                    onClick={() => revoke(app.clientId)}
                  >
                    {revoking === app.clientId && <Loader2 className="animate-spin" />}
                    Revocar
                  </Button>
                </span>
              ) : (
                <Button variant="outline" size="sm" onClick={() => setConfirming(app.clientId)}>
                  Revocar acceso
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
