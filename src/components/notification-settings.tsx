"use client";
import { useEffect, useState } from "react";
import { Bell, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  REMINDER_OFFSETS,
  offsetLabel,
  type NotificationPreferences,
} from "@/lib/notifications";
import { disablePush, pushSupported, registerPush } from "@/lib/push-client";
import { DEFAULT_TIME_ZONE, validTimeZone } from "@/lib/project-time";
import type { Project } from "@/lib/types";
import type { Mutate } from "./forms";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export function NotificationSettings({ userId }: { userId: string }) {
  const [preferences, setPreferences] =
    useState<NotificationPreferences | null>(null);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [supported, setSupported] = useState(false),
    [permission, setPermission] = useState<NotificationPermission>("default");
  const [subscribed, setSubscribed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/notification-preferences", {
        cache: "no-store",
      });
      if (!response.ok) throw Error("No se pudieron cargar tus preferencias.");
      const data = await response.json();
      setPreferences(data.preferences);
      setPublicKey(data.push.publicKey);
      setSupported(pushSupported());
      if (pushSupported()) {
        setPermission(Notification.permission);
        const registration = await navigator.serviceWorker.getRegistration("/");
        setSubscribed(!!(await registration?.pushManager.getSubscription()));
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function save() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/notification-preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(preferences),
      });
      if (!response.ok) throw Error("No se pudieron guardar tus preferencias.");
      toast.success("Preferencias de notificaciones guardadas.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function togglePush() {
    setBusy(true);
    setError("");
    try {
      if (subscribed) {
        await disablePush();
        setSubscribed(false);
      } else if (publicKey)
        setSubscribed(await registerPush(userId, publicKey, true));
      if (pushSupported()) setPermission(Notification.permission);
    } catch (e) {
      setError((e as Error).message);
      if (pushSupported()) setPermission(Notification.permission);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="form-stack notification-settings">
      {error && (
        <p className="notifications-error" role="alert">
          {error}{" "}
          {!preferences && (
            <button onClick={() => void load()}>Reintentar</button>
          )}
        </p>
      )}
      {loading ? (
        <p>
          <Loader2 className="animate-spin" size={18} /> Cargando preferencias…
        </p>
      ) : (
        preferences && (
          <>
            <fieldset disabled={busy}>
              <legend>Recordarme antes del vencimiento</legend>
              <p className="muted">
                Elige hasta tres anticipaciones. Desmarca todas para desactivar
                los recordatorios.
              </p>
              <div className="reminder-options">
                {REMINDER_OFFSETS.map((offset) => (
                  <label key={offset}>
                    <input
                      type="checkbox"
                      checked={preferences.offsets.includes(offset)}
                      disabled={
                        !preferences.offsets.includes(offset) &&
                        preferences.offsets.length >= 3
                      }
                      onChange={(e) =>
                        setPreferences({
                          ...preferences,
                          offsets: e.target.checked
                            ? [...preferences.offsets, offset]
                            : preferences.offsets.filter((o) => o !== offset),
                        })
                      }
                    />
                    {offsetLabel(offset)}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="form-stack">
              Hora para tareas sin hora de vencimiento
              <Input
                type="time"
                value={preferences.dateOnlyTime}
                disabled={busy}
                onChange={(e) =>
                  setPreferences({
                    ...preferences,
                    dateOnlyTime: e.target.value,
                  })
                }
              />
              <span className="muted">
                Se aplica a anticipaciones de 1, 3 y 7 días, en la zona horaria
                de cada proyecto.
              </span>
            </label>
            <Button disabled={busy} onClick={() => void save()}>
              Guardar preferencias
            </Button>
            <hr />
            <h3>Notificaciones en este dispositivo</h3>
            <p className="muted">
              Recibe avisos aunque no tengas Taskode abierto.
            </p>
            <p role="status">
              {!publicKey
                ? "Push pendiente de configuración en el servidor."
                : !supported
                  ? "Push no está disponible en este navegador o conexión."
                  : permission === "denied"
                    ? "Permiso bloqueado. Puedes habilitarlo en los ajustes del navegador."
                    : subscribed
                      ? "Notificaciones activadas en este dispositivo."
                      : "Notificaciones desactivadas en este dispositivo."}
            </p>
            <Button
              variant="outline"
              disabled={
                busy || !publicKey || !supported || permission === "denied"
              }
              onClick={() => void togglePush()}
            >
              <Bell size={16} />
              {subscribed
                ? "Desactivar en este dispositivo"
                : "Activar notificaciones"}
            </Button>
            <p className="muted">
              En iPhone o iPad, abre Taskode en Safari y usa Compartir → Añadir
              a pantalla de inicio. Abre la aplicación instalada para activar
              los avisos.
            </p>
          </>
        )
      )}
    </div>
  );
}
export function ProjectTimezoneSettings({
  project,
  mutate,
  busy,
}: {
  project: Project;
  mutate: Mutate;
  busy: boolean;
}) {
  const [zone, setZone] = useState(project.timeZone || DEFAULT_TIME_ZONE);
  const zones =
    typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("timeZone")
      : [DEFAULT_TIME_ZONE, "UTC"];
  return (
    <div className="form-stack">
      <label>
        Zona horaria del proyecto
        <Input
          list="project-timezones"
          value={zone}
          onChange={(e) => setZone(e.target.value)}
          disabled={busy}
        />
        <datalist id="project-timezones">
          {zones.map((value) => (
            <option key={value} value={value} />
          ))}
        </datalist>
      </label>
      <p className="muted">
        Las fechas y horas de las tareas pertenecen a esta zona. Cambiarla
        conserva las horas escritas y recalcula los recordatorios futuros.
      </p>
      <Button
        disabled={busy || zone === project.timeZone || !validTimeZone(zone)}
        onClick={async () => {
          if (
            await mutate({
              type: "project.timezone.update",
              id: project.id,
              timeZone: zone,
            })
          )
            toast.success("Zona horaria actualizada.");
        }}
      >
        Guardar zona horaria
      </Button>
    </div>
  );
}
