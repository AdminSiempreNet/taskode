import type { TaskComment, TaskCommentsSnapshot, UserSummary } from "./types";

export type ChatConnection =
  "connecting" | "live" | "polling" | "offline" | "denied";
export type ChatState = {
  comments: TaskComment[];
  connection: ChatConnection;
  sending: boolean;
  pending: TaskComment | null;
  error: string;
};
type Connect = (
  channel: string,
  changed: () => void,
  status: (state: ChatConnection) => void,
) => Promise<() => void>;
type Dependencies = {
  fetch?: typeof fetch;
  connect?: Connect;
  visible?: () => boolean;
};

// The controller owns the conversation independently of workspace responses.
// GETs are coalesced; a response started before a write can never replace it.
export class TaskCommentsClient {
  state: ChatState;
  private fetcher: typeof fetch;
  private connect: Connect;
  private visible: () => boolean;
  private stopped = false;
  private revision = 0;
  private refreshing: Promise<void> | null = null;
  private refreshAgain = false;
  private abort = new AbortController();
  private channel: string | null = null;
  private disconnect?: () => void;
  private lastRefresh = 0;
  private timer?: ReturnType<typeof setInterval>;
  private retry?: { content: string; requestId: string };
  private endpoint: string;
  constructor(
    readonly taskId: string,
    initial: TaskComment[],
    private user: UserSummary,
    private changed: (state: ChatState) => void,
    dependencies: Dependencies = {},
  ) {
    this.endpoint = `/api/tasks/${encodeURIComponent(taskId)}/comments`;
    // Native browser fetch needs its global receiver, not this controller.
    this.fetcher = dependencies.fetch ?? globalThis.fetch.bind(globalThis);
    this.visible =
      dependencies.visible ?? (() => document.visibilityState === "visible");
    this.connect = dependencies.connect ?? this.connectAbly.bind(this);
    this.state = {
      comments: initial,
      connection: "connecting",
      sending: false,
      pending: null,
      error: "",
    };
  }
  private emit(patch: Partial<ChatState>) {
    if (this.stopped) return;
    this.state = { ...this.state, ...patch };
    this.changed(this.state);
  }
  start() {
    void this.refresh();
    this.timer = setInterval(() => {
      const interval = this.state.connection === "live" ? 60_000 : 5000;
      if (this.visible() && Date.now() - this.lastRefresh >= interval)
        void this.refresh();
    }, 5000);
  }
  stop() {
    this.stopped = true;
    this.revision++;
    this.abort.abort();
    clearInterval(this.timer);
    this.disconnect?.();
  }
  private deny() {
    this.revision++;
    this.emit({
      connection: "denied",
      comments: [],
      pending: null,
      error: "La sesión terminó o ya no tienes acceso a esta tarea.",
    });
    this.disconnect?.();
  }
  private apply(snapshot: TaskCommentsSnapshot) {
    if (this.stopped || this.state.connection === "denied") return;
    this.emit({ comments: snapshot.comments });
    void this.ensureConnection(snapshot.realtime);
  }
  private async ensureConnection(realtime: TaskCommentsSnapshot["realtime"]) {
    const channel = realtime?.enabled ? realtime.channel : null;
    if (!channel) {
      this.disconnect?.();
      this.disconnect = undefined;
      this.channel = null;
      this.emit({ connection: "polling" });
      return;
    }
    if (this.channel === channel || this.stopped) return;
    this.disconnect?.();
    this.channel = channel;
    this.emit({ connection: "connecting" });
    try {
      const disconnect = await this.connect(
        channel,
        () => {
          void this.refresh();
        },
        (connection) => {
          if (
            !this.stopped &&
            this.channel === channel &&
            this.state.connection !== "denied"
          )
            this.emit({ connection });
        },
      );
      if (this.stopped || this.channel !== channel) disconnect();
      else this.disconnect = disconnect;
    } catch {
      if (this.stopped || this.channel !== channel) return;
      this.channel = null;
      this.emit({ connection: "polling" });
    }
  }
  async refresh(): Promise<void> {
    if (this.stopped || this.state.connection === "denied") return;
    if (this.state.sending) {
      this.refreshAgain = true;
      return;
    }
    if (this.refreshing) {
      this.refreshAgain = true;
      return this.refreshing;
    }
    this.refreshing = (async () => {
      do {
        this.refreshAgain = false;
        const revision = ++this.revision;
        this.lastRefresh = Date.now();
        try {
          const response = await this.fetcher(this.endpoint, {
            cache: "no-store",
            credentials: "same-origin",
            signal: this.abort.signal,
          });
          if (this.stopped || revision !== this.revision || this.state.sending)
            continue;
          if (
            response.status === 401 ||
            response.status === 403 ||
            response.status === 404
          ) {
            this.deny();
            break;
          }
          if (!response.ok)
            throw new Error("No se pudo actualizar la conversación.");
          const snapshot: TaskCommentsSnapshot = await response.json();
          if (
            !this.stopped &&
            revision === this.revision &&
            !this.state.sending
          )
            this.apply(snapshot);
        } catch {
          if (!this.stopped && revision === this.revision)
            this.emit({ connection: "offline" });
        }
      } while (
        this.refreshAgain &&
        !this.stopped &&
        !this.state.sending &&
        this.state.connection !== "denied"
      );
    })().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }
  async mutate(value: unknown): Promise<{ createdId?: string } | null> {
    if (
      this.stopped ||
      this.state.sending ||
      this.state.connection === "denied"
    )
      return null;
    const command = value as { type: string; content?: string };
    this.revision++;
    let body: Record<string, unknown> = { ...command };
    let pending: TaskComment | null = null;
    if (command.type === "comment.create") {
      const content = command.content ?? "";
      if (this.retry?.content !== content)
        this.retry = { content, requestId: crypto.randomUUID() };
      body = { ...body, taskId: this.taskId, requestId: this.retry!.requestId };
      const now = new Date().toISOString();
      pending = {
        id: this.retry!.requestId,
        taskId: this.taskId,
        content,
        authorId: this.user.id,
        author: this.user,
        createdAt: now,
        updatedAt: now,
        canEdit: false,
        canDelete: false,
      };
    }
    this.emit({ sending: true, pending, error: "" });
    try {
      const response = await this.fetcher(this.endpoint, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: this.abort.signal,
      });
      if (this.stopped) return null;
      if (response.status === 401) this.deny();
      const data = await response.json();
      if (this.stopped) return null;
      if (!response.ok)
        throw new Error(
          data.error ||
            "No se pudo enviar. Reintenta sin cerrar la conversación.",
        );
      this.apply(data);
      this.retry = undefined;
      return { createdId: data.createdId };
    } catch (error) {
      if (
        !this.stopped &&
        (this.state.connection as ChatConnection) !== "denied"
      )
        this.emit({
          error:
            error instanceof Error
              ? error.message
              : "No se pudo guardar el mensaje.",
        });
      return null;
    } finally {
      if (!this.stopped) {
        this.emit({ sending: false, pending: null });
        void this.refresh();
      }
    }
  }
  private async connectAbly(
    channelName: string,
    changed: () => void,
    status: (state: ChatConnection) => void,
  ) {
    const { Realtime } = await import("ably");
    if (this.stopped) return () => {};
    const realtime = new Realtime({
      autoConnect: false,
      logLevel: 0,
      authCallback: async (_params, callback) => {
        try {
          const response = await this.fetcher(`${this.endpoint}/token`, {
            method: "POST",
            credentials: "same-origin",
            cache: "no-store",
            signal: this.abort.signal,
          });
          if ([401, 403, 404].includes(response.status)) this.deny();
          if (!response.ok)
            throw new Error("No se pudo autorizar la conversación.");
          callback(null, await response.text());
        } catch {
          callback("No se pudo autorizar la conversación.", null);
        }
      },
    });
    const channel = realtime.channels.get(channelName);
    channel.on("attached", () => {
      status("live");
      changed();
    });
    channel.on(["failed", "suspended"], () => {
      status("offline");
      changed();
    });
    realtime.connection.on(["disconnected", "suspended", "failed"], () => {
      status("offline");
      changed();
    });
    realtime.connect();
    // Subscribe before the authoritative GET on attach, closing the initial-load gap.
    void channel
      .subscribe("comments.changed", changed)
      .catch(() => status("offline"));
    return () => {
      channel.unsubscribe();
      channel.off();
      realtime.connection.off();
      realtime.close();
    };
  }
}
