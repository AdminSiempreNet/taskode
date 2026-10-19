"use client";
import { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  Code2,
  Github,
  Loader2,
  LockKeyhole,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { authClient } from "@/lib/auth-client";
import type { OAuthClientView } from "@/server/oauth-ui";
import { Button } from "./ui/button";
import { TaskodeBrand } from "./taskode-brand";

export function AuthScreen({
  providers,
  bootstrap = false,
  invitation,
  email,
  error,
  returnTo = "/dashboard",
  oauth,
}: {
  providers: { google: boolean; github: boolean };
  bootstrap?: boolean;
  invitation?: string;
  email?: string;
  error?: string;
  returnTo?: string;
  oauth?: OAuthClientView;
}) {
  const [pending, setPending] = useState(""),
    [message, setMessage] = useState(error || "");
  async function signIn(provider: "google" | "github") {
    setPending(provider);
    setMessage("");
    try {
      // With an OAuth request, the client plugin sends the signed query and Better Auth
      // resumes the authorization after the provider callback (callbackURL is ignored).
      const result = await authClient.signIn.social(
        oauth
          ? {
              provider,
              callbackURL: "/dashboard",
              errorCallbackURL: "/login?error=oauth",
              requestSignUp: false,
            }
          : {
              provider,
              callbackURL: returnTo,
              newUserCallbackURL: returnTo,
              errorCallbackURL: invitation ? `/invite/${invitation}` : "/login",
              requestSignUp: bootstrap || Boolean(invitation),
              additionalData: invitation ? { invitation } : undefined,
            },
      );
      if (result.error)
        throw new Error(result.error.message || "No se pudo iniciar sesión.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "No se pudo iniciar sesión.");
      setPending("");
    }
  }
  return (
    <main className="auth-shell">
      <div className="auth-layout">
        <section className="auth-intro" aria-labelledby="auth-intro-title">
          <Link
            className="auth-home-link"
            href="/"
            aria-label="Taskode, volver al inicio"
          >
            <TaskodeBrand />
          </Link>
          <div className="auth-pitch">
            <p className="auth-eyebrow">
              <span />
              Tu desarrollo, organizado
            </p>
            <h2 id="auth-intro-title">
              Del backlog
              <br />
              al siguiente <span>deploy.</span>
            </h2>
            <p className="auth-description">
              Conecta proyectos, features y tareas en un solo espacio. Dale a tu
              equipo claridad para construir lo que sigue.
            </p>
            <div
              className="auth-workflow"
              aria-label="Ejemplo de un tablero de desarrollo"
            >
              <div className="auth-workflow-header">
                <span>
                  <Code2 size={15} />
                  Mi próximo release
                </span>
                <span className="auth-workflow-label">TABLERO</span>
              </div>
              <div className="auth-workflow-columns">
                <div className="auth-workflow-column">
                  <div className="auth-column-title">
                    <span />
                    Backlog
                  </div>
                  <div className="auth-example-task">
                    <small>FEATURE</small>
                    <span>Definir autenticación</span>
                    <span className="auth-task-lines" aria-hidden="true" />
                  </div>
                </div>
                <div className="auth-workflow-column">
                  <div className="auth-column-title">
                    <span />
                    En desarrollo
                  </div>
                  <div className="auth-example-task">
                    <small>TAREA</small>
                    <span>Crear API de tareas</span>
                    <span className="auth-task-lines" aria-hidden="true" />
                  </div>
                </div>
                <div className="auth-workflow-column">
                  <div className="auth-column-title">
                    <span />
                    Hecho
                  </div>
                  <div className="auth-example-task auth-example-complete">
                    <small>
                      <Check size={12} />
                      TAREA
                    </small>
                    <span>Configurar proyecto</span>
                    <span className="auth-task-lines" aria-hidden="true" />
                  </div>
                </div>
              </div>
            </div>
          </div>
          <p className="auth-intro-footer">
            Una idea. Un plan. Tu próxima entrega.
            <ArrowRight size={16} />
          </p>
        </section>
        <section className="auth-card" aria-labelledby="auth-title">
          <div className="auth-card-content">
            <span className="auth-card-eyebrow">TU ESPACIO DE DESARROLLO</span>
            <h1 id="auth-title">
              {oauth
                ? `Conectar ${oauth.name}`
                : invitation
                  ? "Tu equipo te espera"
                  : bootstrap
                    ? "Empieza con Taskode"
                    : "Vuelve a tu proyecto"}
            </h1>
            {oauth && <OAuthClientBadge client={oauth} />}
            <p>
              {oauth ? (
                <>
                  Inicia sesión con tu cuenta de Taskode. Después revisarás
                  qué podrá hacer <strong>{oauth.name}</strong> en tu nombre.
                </>
              ) : email ? (
                <>
                  Continúa con la cuenta cuyo correo es <strong>{email}</strong>
                  .
                </>
              ) : bootstrap ? (
                "Crea tu espacio de trabajo y organiza tu próximo proyecto de software. La primera cuenta será la administradora."
              ) : (
                "Inicia sesión para continuar con tus proyectos y las tareas de tu equipo."
              )}
            </p>
            <div className="auth-providers">
              {providers.google && (
                <Button
                  variant="outline"
                  disabled={Boolean(pending)}
                  aria-busy={pending === "google"}
                  onClick={() => signIn("google")}
                >
                  {pending === "google" ? (
                    <Loader2 className="animate-spin" aria-hidden="true" />
                  ) : (
                    <span className="provider-symbol" aria-hidden="true">
                      G
                    </span>
                  )}
                  {pending === "google"
                    ? "Conectando con Google…"
                    : "Continuar con Google"}
                </Button>
              )}
              {providers.github && (
                <Button
                  variant="outline"
                  disabled={Boolean(pending)}
                  aria-busy={pending === "github"}
                  onClick={() => signIn("github")}
                >
                  {pending === "github" ? (
                    <Loader2 className="animate-spin" aria-hidden="true" />
                  ) : (
                    <Github size={18} aria-hidden="true" />
                  )}
                  {pending === "github"
                    ? "Conectando con GitHub…"
                    : "Continuar con GitHub"}
                </Button>
              )}
            </div>
            {!providers.google && !providers.github && (
              <p className="form-error" role="alert">
                El acceso todavía no está disponible. Contacta con la persona
                que administra este espacio.
              </p>
            )}
            {message && (
              <p className="form-error" role="alert">
                {message}
              </p>
            )}
            <div className="auth-access-note">
              <LockKeyhole size={14} aria-hidden="true" />
              <p className="auth-note">
                {oauth
                  ? "Solo las cuentas que ya tienen acceso a Taskode pueden autorizar aplicaciones."
                  : invitation
                    ? "Tu invitación te dará acceso a los proyectos de tu equipo."
                    : bootstrap
                      ? "Accede de forma segura con tu cuenta de Google o GitHub."
                      : "El acceso a este espacio requiere una invitación."}
              </p>
            </div>
          </div>
          <p className="auth-card-footer">
            Taskode · Proyectos, tareas y código en sintonía.
          </p>
        </section>
      </div>
    </main>
  );
}
export function OAuthClientBadge({ client }: { client: OAuthClientView }) {
  return (
    <div
      className={`oauth-client-badge${client.verifiedHost ? "" : " oauth-client-unverified"}`}
    >
      {client.verifiedHost ? (
        <ShieldCheck size={15} aria-hidden="true" />
      ) : (
        <ShieldAlert size={15} aria-hidden="true" />
      )}
      <span>
        {client.verifiedHost
          ? `Identidad publicada por ${client.verifiedHost}`
          : "Registrada automáticamente: confirma que reconoces esta aplicación."}
        <br />
        {client.loopback
          ? "Devolverá el acceso a una aplicación de este equipo."
          : `Devolverá el acceso a ${client.redirectHost}.`}
      </span>
    </div>
  );
}
