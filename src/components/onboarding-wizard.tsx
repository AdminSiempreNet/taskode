"use client";
import { useState, type FormEvent } from "react";
import { Check, ArrowRight, Loader2 } from "lucide-react";
import type { Workspace } from "@/lib/types";
import { fetchJSON } from "@/lib/http-client";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { InvitationManager } from "./invitation-manager";
import { TaskodeBrand } from "./taskode-brand";
export function OnboardingWizard({ workspace }: { workspace: Workspace }) {
  const [step, setStep] = useState(workspace.onboarding.step),
    [projectId, setProjectId] = useState(workspace.onboarding.firstProjectId),
    [projects, setProjects] = useState(workspace.projects),
    [name, setName] = useState("Mi aplicación web"),
    [description, setDescription] = useState(""),
    [icon, setIcon] = useState("🌐"),
    [color, setColor] = useState("#059669"),
    [demo, setDemo] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await fetchJSON<{ projectId: string }>("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create-project",
          project: { name, description, icon, color },
          demo,
        }),
      });
      setProjectId(result.projectId);
      setProjects((await fetchJSON<Workspace>("/api/workspace")).projects);
      setStep(1);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "No se pudo crear el proyecto.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function finish() {
    setBusy(true);
    setError("");
    try {
      await fetchJSON("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "finish" }),
      });
      window.location.assign("/dashboard");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo terminar.");
      setBusy(false);
    }
  }
  return (
    <main className="onboarding-shell">
      <div className="onboarding-container">
        <TaskodeBrand />
        <ol className="onboarding-steps">
          <li aria-current={step === 0 ? "step" : undefined}>
            <span>{step > 0 ? <Check size={15} /> : "1"}</span>Tu primer
            proyecto
          </li>
          <li aria-current={step === 1 ? "step" : undefined}>
            <span>2</span>Invita a tu equipo
          </li>
        </ol>
        <section className="onboarding-card">
          <h1>
            {step === 0
              ? "Dale forma a tu primer proyecto"
              : "Trabaja con tu equipo"}
          </h1>
          <p>
            {step === 0
              ? "Empieza desde cero o explora un proyecto de ejemplo sobre una aplicación web."
              : "Envía invitaciones y comparte enlaces. También puedes invitar a más personas después."}
          </p>
          {step === 0 ? (
            <form onSubmit={create} className="form-stack">
              <label htmlFor="first-project-name">Nombre del proyecto</label>
              <Input
                id="first-project-name"
                required
                maxLength={160}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <label htmlFor="first-project-description">Descripción</label>
              <Textarea
                id="first-project-description"
                value={description}
                maxLength={30000}
                onChange={(e) => setDescription(e.target.value)}
              />
              <div className="onboarding-properties">
                <label>
                  Icono
                  <Input
                    aria-label="Icono del proyecto"
                    required
                    maxLength={32}
                    value={icon}
                    onChange={(e) => setIcon(e.target.value)}
                  />
                </label>
                <label>
                  Color
                  <Input
                    aria-label="Color del proyecto"
                    type="color"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                  />
                </label>
              </div>
              <label className="demo-option">
                <input
                  type="checkbox"
                  checked={demo}
                  onChange={(e) => setDemo(e.target.checked)}
                />
                <span>
                  <strong>Usar datos de ejemplo</strong>
                  <small>
                    Una aplicación web con módulos, features, tareas y
                    checklists.
                  </small>
                </span>
              </label>
              <Button type="submit" disabled={busy}>
                {busy ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <ArrowRight size={16} />
                )}
                Crear proyecto y continuar
              </Button>
            </form>
          ) : (
            <>
              <InvitationManager
                projects={projects}
                defaultProjectId={projectId || undefined}
              />
              <div className="onboarding-finish">
                <Button disabled={busy} onClick={finish}>
                  {busy ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Check size={16} />
                  )}
                  Terminar configuración
                </Button>
              </div>
            </>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
