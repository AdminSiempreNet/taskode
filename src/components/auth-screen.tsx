"use client";
import { useState } from "react";
import { Sprout, Loader2, Github } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { Button } from "./ui/button";

export function AuthScreen({
  providers,
  bootstrap = false,
  invitation,
  email,
  error,
}: {
  providers: { google: boolean; github: boolean };
  bootstrap?: boolean;
  invitation?: string;
  email?: string;
  error?: string;
}) {
  const [pending, setPending] = useState(""),
    [message, setMessage] = useState(error || "");
  async function signIn(provider: "google" | "github") {
    setPending(provider);
    setMessage("");
    try {
      const result = await authClient.signIn.social({
        provider,
        callbackURL: "/",
        newUserCallbackURL: "/",
        errorCallbackURL: invitation ? `/invite/${invitation}` : "/login",
        requestSignUp: bootstrap || Boolean(invitation),
        additionalData: invitation ? { invitation } : undefined,
      });
      if (result.error)
        throw new Error(result.error.message || "No se pudo iniciar sesión.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "No se pudo iniciar sesión.");
      setPending("");
    }
  }
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="auth-brand">
          <Sprout size={30} />
          <span>Brote</span>
        </div>
        <h1>
          {invitation
            ? "Te han invitado a colaborar"
            : bootstrap
              ? "Bienvenido a Brote"
              : "Inicia sesión"}
        </h1>
        <p>
          {email ? (
            <>
              Continúa con la cuenta cuyo correo es <strong>{email}</strong>.
            </>
          ) : bootstrap ? (
            "La primera cuenta que acceda será la administradora de este espacio."
          ) : (
            "Accede a tus proyectos con una cuenta autorizada."
          )}
        </p>
        <div className="auth-providers">
          {providers.google && (
            <Button
              variant="outline"
              disabled={Boolean(pending)}
              onClick={() => signIn("google")}
            >
              {pending === "google" ? (
                <Loader2 className="animate-spin" />
              ) : (
                <span className="provider-symbol">G</span>
              )}
              Continuar con Google
            </Button>
          )}
          {providers.github && (
            <Button
              variant="outline"
              disabled={Boolean(pending)}
              onClick={() => signIn("github")}
            >
              {pending === "github" ? (
                <Loader2 className="animate-spin" />
              ) : (
              <Github size={18} />
              )}
              Continuar con GitHub
            </Button>
          )}
        </div>
        {!providers.google && !providers.github && (
          <p className="form-error" role="alert">
            El acceso aún no está configurado. Completa las variables de entorno
            indicadas en .env.example.
          </p>
        )}
        {message && (
          <p className="form-error" role="alert">
            {message}
          </p>
        )}
        {!bootstrap && !invitation && (
          <p className="auth-note">
            El registro requiere una invitación del administrador.
          </p>
        )}
      </section>
    </main>
  );
}
