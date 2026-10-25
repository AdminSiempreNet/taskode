import type { NotificationItem, NotificationsSnapshot } from "./notifications";

export type NotificationsState = {
  snapshot: NotificationsSnapshot | null;
  error: string;
  live: boolean;
};
// projectId null means "anything may have changed", e.g. after a reconnection.
export type WorkspaceListener = (projectId: string | null) => void;
type Connect = (
  channel: string,
  changed: () => void,
  status: (live: boolean) => void,
  workspaceChanged: WorkspaceListener,
) => Promise<() => void>;
export class NotificationsClient {
  state: NotificationsState = { snapshot: null, error: "", live: false };
  private listeners = new Set<() => void>();
  private workspaceListeners = new Set<WorkspaceListener>();
  private timer?: ReturnType<typeof setInterval>;
  private release?: ReturnType<typeof setTimeout>;
  private disconnect?: () => void;
  private pending: Promise<void> | null = null;
  private again = false;
  private revision = 0;
  private generation = 0;
  private known = new Set<string>();
  private primed = false;
  private latestSeenTime = -Infinity;
  private latestSequence = -Infinity;
  private channel: string | null = null;
  private stopped = true;
  constructor(
    readonly userId: string,
    private dependencies: {
      fetch?: typeof fetch;
      connect?: Connect;
      visible?: () => boolean;
      newItem?: (item: NotificationItem) => void;
    } = {},
  ) {}
  private fetcher = (url: string, options?: RequestInit) =>
    (this.dependencies.fetch ?? globalThis.fetch)(url, {
      credentials: "same-origin",
      cache: "no-store",
      ...options,
    });
  private emit(patch: Partial<NotificationsState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  getSnapshot = () => this.state;
  // Task changes share this channel; the listener keeps the client running.
  onWorkspaceChanged(listener: WorkspaceListener) {
    this.workspaceListeners.add(listener);
    const release = this.subscribe(() => {});
    return () => {
      this.workspaceListeners.delete(listener);
      release();
    };
  }
  private workspaceChanged = (projectId: string | null) => {
    for (const listener of this.workspaceListeners) listener(projectId);
  };
  subscribe = (listener: () => void) => {
    clearTimeout(this.release);
    this.listeners.add(listener);
    if (this.stopped) this.start();
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size)
        this.release = setTimeout(() => this.stop(), 100);
    };
  };
  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.generation++;
    void this.refresh();
    this.timer = setInterval(() => {
      if (!this.state.live && this.visible()) void this.refresh();
    }, 30000);
    if (typeof window !== "undefined") {
      window.addEventListener("focus", this.focus);
      document.addEventListener("visibilitychange", this.focus);
    }
  }
  stop() {
    this.stopped = true;
    this.generation++;
    this.disconnect?.();
    this.disconnect = undefined;
    this.channel = null;
    clearInterval(this.timer);
    if (typeof window !== "undefined") {
      window.removeEventListener("focus", this.focus);
      document.removeEventListener("visibilitychange", this.focus);
    }
    this.emit({ live: false });
  }
  private visible = () =>
    this.dependencies.visible?.() ??
    (typeof document !== "undefined" && document.visibilityState === "visible");
  private focus = () => {
    if (this.visible()) void this.refresh();
  };
  refresh = async () => {
    if (this.stopped) return;
    if (this.pending) {
      this.again = true;
      return this.pending;
    }
    this.pending = (async () => {
      do {
        this.again = false;
        const revision = this.revision,
          generation = this.generation;
        try {
          const response = await this.fetcher("/api/notifications?limit=10");
          if (response.status === 401) {
            this.emit({ snapshot: null, error: "Tu sesión terminó." });
            this.stop();
            return;
          }
          if (!response.ok)
            throw Error("No se pudieron actualizar las notificaciones.");
          const snapshot: NotificationsSnapshot = await response.json();
          if (this.stopped) return;
          if (generation !== this.generation) {
            this.again = true;
            continue;
          }
          if (revision !== this.revision) {
            this.again = true;
            continue;
          }
          const fresh = this.primed
            ? snapshot.items
                .filter(
                  (i) =>
                    !this.known.has(i.id) &&
                    !i.readAt &&
                    (i.sequence !== undefined
                      ? i.sequence > this.latestSequence
                      : Date.parse(i.createdAt) >= this.latestSeenTime),
                )
                .reverse()
            : [];
          for (const item of snapshot.items) this.known.add(item.id);
          for (const item of snapshot.items)
            this.latestSeenTime = Math.max(
              this.latestSeenTime,
              Date.parse(item.createdAt),
            );
          for (const item of snapshot.items)
            if (item.sequence !== undefined)
              this.latestSequence = Math.max(
                this.latestSequence,
                item.sequence,
              );
          this.primed = true;
          this.emit({ snapshot, error: "" });
          if (this.visible())
            for (const item of fresh.slice(-3))
              this.dependencies.newItem?.(item);
          if (
            snapshot.realtime.channel &&
            snapshot.realtime.channel !== this.channel
          ) {
            this.channel = snapshot.realtime.channel;
            try {
              const close = await (
                this.dependencies.connect ?? connectNotifications
              )(
                this.channel,
                () => {
                  void this.refresh();
                },
                (live) => {
                  if (!this.stopped && generation === this.generation)
                    this.emit({ live });
                },
                this.workspaceChanged,
              );
              if (this.stopped || generation !== this.generation) close();
              else this.disconnect = close;
            } catch {
              this.channel = null;
              this.emit({ live: false });
            }
          }
        } catch (error) {
          if (!this.stopped)
            this.emit({ error: (error as Error).message, live: false });
        }
      } while (this.again && !this.stopped);
    })().finally(() => {
      this.pending = null;
    });
    return this.pending;
  };
  async read(id: string, read = true) {
    await this.mutate(`/api/notifications/${encodeURIComponent(id)}`, "PATCH", {
      read,
    });
  }
  async readAll(through: string) {
    await this.mutate("/api/notifications/read-all", "POST", { through });
  }
  private async mutate(url: string, method: string, body: unknown) {
    this.revision++;
    const response = await this.fetcher(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw Error("No se pudo actualizar la notificación.");
    this.revision++;
    await this.refresh();
  }
}
async function connectNotifications(
  channel: string,
  changed: () => void,
  status: (live: boolean) => void,
  workspaceChanged: WorkspaceListener,
) {
  const { Realtime } = await import("ably");
  const client = new Realtime({
    autoConnect: false,
    logLevel: 0,
    authCallback: async (_params, callback) => {
      try {
        const response = await fetch("/api/notifications/token", {
          method: "POST",
          credentials: "same-origin",
        });
        if (!response.ok) throw Error("No se pudo autorizar la conexión.");
        callback(null, await response.text());
      } catch {
        callback("No se pudo autorizar la conexión.", null);
      }
    },
  });
  const sub = client.channels.get(channel);
  let connectedBefore = false;
  client.connection.on((change) => {
    status(change.current === "connected" && sub.state === "attached");
    if (change.current !== "connected") return;
    changed();
    // Task events can be lost while disconnected; resync the board on reconnection.
    if (connectedBefore) workspaceChanged(null);
    connectedBefore = true;
  });
  sub.on((change) =>
    status(
      change.current === "attached" && client.connection.state === "connected",
    ),
  );
  client.connect();
  // Attaching can wait indefinitely while offline. Keep HTTP polling available
  // and return cleanup immediately while Ably manages reconnection.
  void sub
    .subscribe("notifications.changed", changed)
    .catch(() => status(false));
  void sub
    .subscribe("workspace.changed", (message) => {
      const projectId = (message.data as { projectId?: unknown } | undefined)
        ?.projectId;
      workspaceChanged(typeof projectId === "string" ? projectId : null);
    })
    .catch(() => status(false));
  return () => {
    client.close();
  };
}
