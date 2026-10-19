"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  Bell,
  Check,
  CheckCheck,
  Loader2,
  ArrowUpRight,
  Clock3,
} from "lucide-react";
import { toast } from "sonner";
import { NotificationsClient } from "@/lib/notifications-client";
import {
  notificationText,
  type NotificationItem,
  type NotificationsSnapshot,
} from "@/lib/notifications";
import { useWorkspaceRouter } from "./unsaved-changes";
import { Button } from "./ui/button";
import { Popover } from "radix-ui";
import { registerPush } from "@/lib/push-client";

const clients = new Map<string, NotificationsClient>();
function clientFor(userId: string) {
  let client = clients.get(userId);
  if (!client) {
    for (const cached of clients.values()) cached.stop();
    clients.clear();
    client = new NotificationsClient(userId, {
      newItem: (item) => {
        if (document.hasFocus())
          window.dispatchEvent(
            new CustomEvent("taskode:notification", { detail: item }),
          );
      },
    });
    clients.set(userId, client);
  }
  return client;
}
const initial = { snapshot: null, error: "", live: false };
export function useNotifications(userId: string) {
  const client = clientFor(userId);
  const state = useSyncExternalStore(
    client.subscribe,
    client.getSnapshot,
    () => initial,
  );
  return { ...state, client };
}
export function useOpenNotification(userId: string) {
  const router = useWorkspaceRouter();
  return useCallback(
    async (id: string) => {
      try {
        const response = await fetch(
          `/api/notifications/${encodeURIComponent(id)}`,
          { cache: "no-store" },
        );
        if (!response.ok)
          throw Error("Esta notificación ya no está disponible.");
        const target: { projectId: string | null; taskId: string | null; url: string } =
          await response.json();
        await clientFor(userId).read(id);
        router.push(target.url);
      } catch (error) {
        toast.error((error as Error).message);
      }
    },
    [router, userId],
  );
}
function relativeDate(value: string) {
  const elapsed = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(value)) / 1000),
  );
  if (elapsed < 60) return "Ahora";
  const unit = elapsed < 3600 ? "minute" : elapsed < 86400 ? "hour" : "day";
  const count = Math.floor(
    elapsed / (unit === "minute" ? 60 : unit === "hour" ? 3600 : 86400),
  );
  return new Intl.RelativeTimeFormat("es", { numeric: "auto" }).format(
    -count,
    unit,
  );
}
function NotificationRow({
  item,
  open,
  read,
}: {
  item: NotificationItem;
  open: () => void;
  read: () => void;
}) {
  return (
    <li
      className={`notification-row ${item.readAt ? "" : "notification-unread"}`}
    >
      <span className="notification-symbol" aria-hidden="true">
        {item.type === "reminder" ? <Clock3 size={18} /> : <Bell size={18} />}
      </span>
      <button className="notification-open" onClick={open}>
        <span>{notificationText(item)}</span>
        <strong>{item.taskTitle}</strong>
        <small>
          {item.projectName && item.projectName !== item.taskTitle ? `${item.projectName} · ` : ""}
          <time
            dateTime={item.createdAt}
            title={new Date(item.createdAt).toLocaleString("es-CO")}
          >
            {relativeDate(item.createdAt)}
          </time>
          {!item.readAt && <span className="sr-only"> · No leída</span>}
        </small>
      </button>
      <button
        className="notification-read"
        onClick={read}
        aria-label={item.readAt ? "Marcar como no leída" : "Marcar como leída"}
        title={item.readAt ? "Marcar como no leída" : "Marcar como leída"}
      >
        <Check size={16} />
      </button>
    </li>
  );
}
export function NotificationBell({ userId }: { userId: string }) {
  const { snapshot, error, client } = useNotifications(userId);
  const open = useOpenNotification(userId),
    router = useWorkspaceRouter();
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    void fetch("/api/notification-preferences", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return;
        const data = await response.json();
        if (data.push.publicKey)
          await registerPush(userId, data.push.publicKey, false);
      })
      .catch(() => {});
  }, [userId]);
  useEffect(() => {
    const navigate = (event: MessageEvent) => {
      if (
        event.data?.type === "taskode:open-notification" &&
        typeof event.data.notificationId === "string" &&
        /^[a-f0-9-]{36}$/.test(event.data.notificationId)
      )
        router.push(`/notifications?open=${event.data.notificationId}`);
    };
    navigator.serviceWorker?.addEventListener("message", navigate);
    return () =>
      navigator.serviceWorker?.removeEventListener("message", navigate);
  }, [router]);
  useEffect(() => {
    const receive = (event: Event) => {
      const item = (event as CustomEvent<NotificationItem>).detail;
      toast(notificationText(item), {
        id: `notification:${item.id}`,
        description: item.taskTitle,
        action: {
          label: item.type === "invitation_accepted" || item.type.startsWith("project_access_") ? "Abrir" : item.type === "mention" ? "Ver mención" : "Ver tarea",
          onClick: () => {
            void open(item.id);
          },
        },
      });
    };
    window.addEventListener("taskode:notification", receive);
    return () => window.removeEventListener("taskode:notification", receive);
  }, [open]);
  return (
    <Popover.Root
      open={expanded}
      onOpenChange={(value) => {
        setExpanded(value);
        if (value) void client.refresh();
      }}
    >
      <Popover.Trigger asChild>
        <button
          className="notification-bell"
          aria-label={`Notificaciones${snapshot?.unreadCount ? `, ${snapshot.unreadCount} sin leer` : ""}`}
          title="Notificaciones"
        >
          <Bell size={20} />
          <span className="notification-bell-label">Notificaciones</span>
          {!!snapshot?.unreadCount && (
            <span className="notification-count">
              {snapshot.unreadCount > 99 ? "99+" : snapshot.unreadCount}
            </span>
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={8}
          className="notifications-dropdown"
          aria-label="Notificaciones recientes"
        >
          <div className="notifications-heading">
            <strong>Notificaciones</strong>
            <button
              title="Marcar todas como leídas"
              aria-label="Marcar todas como leídas"
              disabled={!snapshot?.unreadCount}
              onClick={() => {
                if (snapshot?.through)
                  void client
                    .readAll(snapshot.through)
                    .catch((e) => toast.error(e.message));
              }}
            >
              <CheckCheck size={18} />
            </button>
          </div>
          {error && (
            <p className="notifications-error" role="status">
              {error}{" "}
              <button onClick={() => void client.refresh()}>Reintentar</button>
            </p>
          )}
          {!snapshot ? (
            <p className="notifications-empty">
              <Loader2 size={18} className="animate-spin" /> Cargando…
            </p>
          ) : !snapshot.items.length ? (
            <p className="notifications-empty">
              Estás al día. Aquí aparecerán tus avisos.
            </p>
          ) : (
            <ul className="notifications-list">
              {snapshot.items.map((item) => (
                <NotificationRow
                  key={item.id}
                  item={item}
                  open={() => {
                    setExpanded(false);
                    void open(item.id);
                  }}
                  read={() =>
                    void client
                      .read(item.id, !!item.readAt)
                      .catch((e) => toast.error(e.message))
                  }
                />
              ))}
            </ul>
          )}
          <button
            className="notifications-see-all"
            onClick={() => {
              setExpanded(false);
              router.push("/notifications");
            }}
          >
            Ver todas <ArrowUpRight size={15} />
          </button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
export function NotificationsPage({
  userId,
  openId,
}: {
  userId: string;
  openId?: string;
}) {
  const { snapshot: recent, client } = useNotifications(userId);
  const open = useOpenNotification(userId);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [snapshot, setSnapshot] = useState<NotificationsSnapshot | null>(null);
  const loadRevision = useRef(0);
  const desiredCount = useRef(30);
  const [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const load = useCallback(
    async (cursor?: string, signal?: AbortSignal) => {
      if (cursor) desiredCount.current += 30;
      const revision = ++loadRevision.current;
      setLoading(true);
      setError("");
      try {
        const response = await fetch(
          `/api/notifications?filter=${filter}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
          { cache: "no-store", signal },
        );
        if (!response.ok)
          throw Error("No se pudieron cargar las notificaciones.");
        let next: NotificationsSnapshot = await response.json();
        // Background invalidations retain the pages the user already opened.
        // A bell refresh must not collapse a just-requested second page.
        if (!cursor) {
          const items = [...next.items];
          let nextCursor = next.nextCursor;
          while (nextCursor && items.length < desiredCount.current) {
            if (signal?.aborted || revision !== loadRevision.current) return;
            const more = await fetch(
              `/api/notifications?filter=${filter}&cursor=${encodeURIComponent(nextCursor)}`,
              { cache: "no-store", signal },
            );
            if (!more.ok)
              throw Error("No se pudieron cargar las notificaciones.");
            const page: NotificationsSnapshot = await more.json();
            items.push(...page.items);
            nextCursor = page.nextCursor;
          }
          next = { ...next, items, nextCursor };
        }
        if (signal?.aborted || revision !== loadRevision.current) return;
        setSnapshot((previous) =>
          cursor && previous
            ? {
                ...next,
                through: previous.through,
                items: [
                  ...previous.items,
                  ...next.items.filter(
                    (i) => !previous.items.some((p) => p.id === i.id),
                  ),
                ],
              }
            : next,
        );
      } catch (e) {
        if (!signal?.aborted && revision === loadRevision.current)
          setError((e as Error).message);
      } finally {
        if (!signal?.aborted && revision === loadRevision.current)
          setLoading(false);
      }
    },
    [filter],
  );
  useEffect(() => {
    const abort = new AbortController();
    void load(undefined, abort.signal);
    return () => abort.abort();
  }, [load, recent]);
  useEffect(() => {
    if (openId) void open(openId);
  }, [openId, open]);
  return (
    <section className="notifications-page">
      <header className="notifications-page-title">
        <div>
          <p className="muted">Tu actividad</p>
          <h1>Notificaciones</h1>
          <p>Asignaciones, tareas compartidas y próximos vencimientos.</p>
        </div>
        <Button
          variant="outline"
          disabled={!snapshot?.unreadCount || loading}
          onClick={() => {
            if (snapshot?.through)
              void client
                .readAll(snapshot.through)
                .then(() => load())
                .catch((e) => setError(e.message));
          }}
        >
          <CheckCheck size={16} /> Marcar todas como leídas
        </Button>
      </header>
      <div
        className="notifications-filters"
        role="group"
        aria-label="Filtrar notificaciones"
      >
        <Button
          variant={filter === "all" ? "default" : "ghost"}
          onClick={() => {
            if (filter !== "all") desiredCount.current = 30;
            setFilter("all");
          }}
        >
          Todas
        </Button>
        <Button
          variant={filter === "unread" ? "default" : "ghost"}
          onClick={() => {
            if (filter !== "unread") desiredCount.current = 30;
            setFilter("unread");
          }}
        >
          No leídas{recent?.unreadCount ? ` (${recent.unreadCount})` : ""}
        </Button>
      </div>
      {error && (
        <p className="notifications-error" role="alert">
          {error} <button onClick={() => void load()}>Reintentar</button>
        </p>
      )}
      {!snapshot && loading ? (
        <p className="notifications-empty">
          <Loader2 className="animate-spin" /> Cargando notificaciones…
        </p>
      ) : !snapshot?.items.length ? (
        <div className="notifications-empty">
          <Bell size={30} />
          <h2>{filter === "unread" ? "Todo leído" : "Estás al día"}</h2>
          <p>Los nuevos avisos aparecerán aquí.</p>
        </div>
      ) : (
        <ul className="notifications-list">
          {snapshot.items.map((item) => (
            <NotificationRow
              key={item.id}
              item={item}
              open={() => void open(item.id)}
              read={() =>
                void client
                  .read(item.id, !!item.readAt)
                  .then(() => load())
                  .catch((e) => setError(e.message))
              }
            />
          ))}
        </ul>
      )}
      {snapshot?.nextCursor && (
        <Button
          variant="outline"
          disabled={loading}
          onClick={() => void load(snapshot.nextCursor!)}
        >
          {loading ? "Cargando…" : "Cargar más"}
        </Button>
      )}
    </section>
  );
}
