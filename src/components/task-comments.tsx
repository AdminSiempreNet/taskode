"use client";

import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { Editor } from "@tiptap/react";
import {
  ArrowDown,
  Check,
  ChevronDown,
  Clock3,
  Loader2,
  MessageSquare,
  Paperclip,
  Pencil,
  Send,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { EmojiPicker } from "./emoji-picker";
import { MessageEditor } from "./message-editor";
import { MarkdownContent } from "./markdown-content";
import { UserAvatar } from "./user-avatar";
import type { Confirmation, Mutate } from "./forms";
import type { Task, TaskComment } from "@/lib/types";
import { uploadFile } from "@/lib/file-client";
import styles from "./task-comments.module.css";

const timeZone = "America/Bogota";
const dateKey = new Intl.DateTimeFormat("en-CA", {
  timeZone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const shortTime = new Intl.DateTimeFormat("es-CO", {
  timeZone,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const fullDate = new Intl.DateTimeFormat("es-CO", {
  timeZone,
  day: "numeric",
  month: "long",
  year: "numeric",
});
const authorColors = [
  "#007e68",
  "#a46a24",
  "#8e4c9f",
  "#2e75a7",
  "#b25370",
  "#6b7533",
];

function dayLabel(value: string) {
  const date = new Date(value),
    now = new Date();
  const key = dateKey.format(date);
  if (key === dateKey.format(now)) return "Hoy";
  if (key === dateKey.format(new Date(now.getTime() - 86_400_000)))
    return "Ayer";
  return fullDate.format(date);
}

function sameGroup(previous: TaskComment | undefined, current: TaskComment) {
  const elapsed = previous
    ? Date.parse(current.createdAt) - Date.parse(previous.createdAt)
    : -1;
  return (
    !!previous &&
    !!current.authorId &&
    previous.authorId === current.authorId &&
    elapsed >= 0 &&
    elapsed < 300_000 &&
    dateKey.format(new Date(previous.createdAt)) ===
      dateKey.format(new Date(current.createdAt))
  );
}

export function TaskComments({
  task,
  comments,
  pending,
  error,
  mutate,
  busy,
  confirm,
  content,
  setContent,
  currentUserId,
}: {
  task: Task;
  comments: TaskComment[];
  pending: TaskComment | null;
  error: string;
  mutate: Mutate;
  busy: boolean;
  confirm: (value: Confirmation) => void;
  content: string;
  setContent: (value: string) => void;
  currentUserId: string;
}) {
  const thread = useRef<HTMLDivElement>(null);
  const history = useRef<HTMLDivElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const editor = useRef<Editor | null>(null);
  const nearBottom = useRef(true);
  const previousIds = useRef(new Set(comments.map((comment) => comment.id)));
  const [uploading, setUploading] = useState(0);
  const [attaching, setAttaching] = useState(false);
  const [unread, setUnread] = useState(0);
  const shown =
    pending && !comments.some((comment) => comment.id === pending.id)
      ? [...comments, pending]
      : comments;
  const blocked = busy || attaching || uploading > 0;

  useEffect(() => {
    const additions = comments.filter(
      (comment) =>
        !previousIds.current.has(comment.id) &&
        comment.authorId !== currentUserId,
    ).length;
    previousIds.current = new Set(comments.map((comment) => comment.id));
    if (thread.current && nearBottom.current) {
      thread.current.scrollTop = thread.current.scrollHeight;
      setUnread(0);
    } else if (additions) setUnread((count) => count + additions);
  }, [comments, pending, currentUserId]);

  useEffect(() => {
    if (!history.current) return;
    const observer = new ResizeObserver(() => {
      if (thread.current && nearBottom.current)
        thread.current.scrollTop = thread.current.scrollHeight;
    });
    observer.observe(history.current);
    return () => observer.disconnect();
  }, []);

  async function attachImage(file: File) {
    const target = editor.current;
    if (!target || blocked) return;
    setAttaching(true);
    try {
      const image = await uploadFile(file, task.projectId, task.id, "image");
      if (editor.current === target && !target.isDestroyed)
        target
          .chain()
          .focus()
          .setImage({ src: image.url, alt: file.name })
          .run();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudo adjuntar la imagen.",
      );
    } finally {
      setAttaching(false);
    }
  }

  return (
    <>
      <div className={styles.historyShell}>
        <div
          className={styles.thread}
          ref={thread}
          role="log"
          aria-label="Conversación de la tarea"
          aria-live="polite"
          aria-relevant="additions text"
          onScroll={() => {
            if (!thread.current) return;
            nearBottom.current =
              thread.current.scrollHeight -
                thread.current.scrollTop -
                thread.current.clientHeight <
              80;
            if (nearBottom.current) setUnread(0);
          }}
        >
          <div className={styles.history} ref={history}>
            {!shown.length ? (
              <div className={styles.empty}>
                <span className={styles.emptyIcon}>
                  <MessageSquare size={28} strokeWidth={1.6} />
                </span>
                <strong>La conversación empieza aquí</strong>
                <p>Comparte una idea, una imagen o un avance con tu equipo.</p>
              </div>
            ) : (
              shown.map((comment, index) => {
                const previous = shown[index - 1];
                const newDay =
                  !previous ||
                  dateKey.format(new Date(previous.createdAt)) !==
                    dateKey.format(new Date(comment.createdAt));
                return (
                  <Fragment key={comment.id}>
                    {newDay && (
                      <div className={styles.daySeparator}>
                        <span>{dayLabel(comment.createdAt)}</span>
                      </div>
                    )}
                    <ChatMessage
                      comment={comment}
                      task={task}
                      currentUserId={currentUserId}
                      grouped={sameGroup(previous, comment)}
                      pending={pending?.id === comment.id}
                      mutate={mutate}
                      busy={busy}
                      confirm={confirm}
                    />
                  </Fragment>
                );
              })
            )}
          </div>
        </div>
        {unread > 0 && (
          <button
            type="button"
            className={styles.newMessages}
            onClick={() => {
              if (thread.current)
                thread.current.scrollTop = thread.current.scrollHeight;
              nearBottom.current = true;
              setUnread(0);
            }}
          >
            <span>{unread}</span>
            {unread === 1 ? "Mensaje nuevo" : "Mensajes nuevos"}
            <ArrowDown size={15} />
          </button>
        )}
      </div>
      <form
        ref={form}
        className={styles.composer}
        onSubmit={async (event) => {
          event.preventDefault();
          if (!content.trim() || blocked) return;
          nearBottom.current = true;
          if (
            await mutate({ type: "comment.create", taskId: task.id, content })
          ) {
            setContent("");
            editor.current?.commands.focus();
          }
        }}
      >
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        {(uploading > 0 || attaching) && (
          <p className={styles.uploadStatus} role="status">
            <Loader2 size={13} className="animate-spin" />
            Cargando imagen…
          </p>
        )}
        <div className={styles.composerRow}>
          <div className={styles.inputShell}>
            <div className={styles.composerTools}>
              <EmojiPicker
                value=""
                disabled={blocked}
                onChange={(emoji) =>
                  editor.current
                    ?.chain()
                    .focus()
                    .insertContent({ type: "text", text: emoji })
                    .run()
                }
              />
              <button
                type="button"
                className={styles.attachButton}
                aria-label="Adjuntar imagen"
                title="Adjuntar imagen"
                disabled={blocked}
                onClick={() => fileInput.current?.click()}
              >
                <Paperclip size={20} />
              </button>
              <input
                ref={fileInput}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp,image/avif"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void attachImage(file);
                }}
              />
            </div>
            <div className={styles.editor}>
              <MessageEditor
                value={content}
                onChange={setContent}
                projectId={task.projectId}
                taskId={task.id}
                disabled={busy || attaching}
                onSend={() => form.current?.requestSubmit()}
                onUploading={setUploading}
                onReady={(value) => {
                  editor.current = value;
                }}
              />
            </div>
          </div>
          <button
            type="submit"
            className={styles.sendButton}
            disabled={blocked || !content.trim()}
            aria-label={busy ? "Enviando comentario" : "Enviar comentario"}
            title="Enviar comentario"
          >
            {busy ? (
              <Loader2 size={20} className="animate-spin" />
            ) : (
              <Send size={20} />
            )}
          </button>
        </div>
        <span className={styles.composerHint}>
          Enter para enviar · Mayús + Enter para una nueva línea
        </span>
      </form>
    </>
  );
}

function ChatMessage({
  comment,
  task,
  currentUserId,
  grouped,
  pending,
  mutate,
  busy,
  confirm,
}: {
  comment: TaskComment;
  task: Task;
  currentUserId: string;
  grouped: boolean;
  pending: boolean;
  mutate: Mutate;
  busy: boolean;
  confirm: (value: Confirmation) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(comment.content);
  const [uploading, setUploading] = useState(0);
  const editForm = useRef<HTMLFormElement>(null);
  const own = comment.authorId === currentUserId;
  const author = comment.author?.name ?? (own ? "Tú" : "Usuario anterior");
  const colorIndex = [...(comment.authorId ?? author)].reduce(
    (hash, character) =>
      (hash + character.codePointAt(0)!) % authorColors.length,
    0,
  );
  const edited = comment.updatedAt !== comment.createdAt;
  const fullTimestamp = `${fullDate.format(new Date(comment.createdAt))}, ${shortTime.format(new Date(comment.createdAt))}`;
  const cancelEditing = () => {
    setContent(comment.content);
    setEditing(false);
  };
  useEffect(() => {
    if (!editing) setContent(comment.content);
  }, [comment.content, editing]);

  return (
    <article
      className={`${styles.message} ${own ? styles.own : styles.other} ${grouped ? styles.grouped : ""}`}
      style={
        { "--chat-author-color": authorColors[colorIndex] } as CSSProperties
      }
      aria-label={`${own ? "Tú" : author}, ${fullTimestamp}`}
      aria-busy={pending || undefined}
    >
      <span className={styles.avatar} title={author}>
        <UserAvatar name={author} image={comment.author?.image} />
      </span>
      <div className={`${styles.bubble} ${editing ? styles.editing : ""}`}>
        {!grouped && <div className={styles.author}>{own ? "Tú" : author}</div>}
        {!editing && !pending && (comment.canEdit || comment.canDelete) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={styles.messageMenu}
                disabled={busy}
                aria-label="Opciones del mensaje"
                title="Opciones del mensaje"
              >
                <ChevronDown size={17} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align={own ? "end" : "start"}>
              {comment.canEdit && (
                <DropdownMenuItem onSelect={() => setEditing(true)}>
                  <Pencil size={14} />
                  Editar mensaje
                </DropdownMenuItem>
              )}
              {comment.canDelete && (
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() =>
                    confirm({
                      title: "¿Eliminar este mensaje?",
                      description:
                        "El mensaje se eliminará de la conversación para todos.",
                      action: () =>
                        mutate({ type: "comment.delete", id: comment.id }),
                    })
                  }
                >
                  <Trash2 size={14} />
                  Eliminar mensaje
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {editing ? (
          <form
            ref={editForm}
            className={styles.editForm}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                cancelEditing();
              }
            }}
            onSubmit={async (event) => {
              event.preventDefault();
              if (busy || uploading || !content.trim()) return;
              if (
                await mutate({
                  type: "comment.update",
                  id: comment.id,
                  content,
                })
              )
                setEditing(false);
            }}
          >
            <span className={styles.editLabel}>Editar mensaje</span>
            <MessageEditor
              value={content}
              onChange={setContent}
              projectId={task.projectId}
              taskId={task.id}
              disabled={busy}
              onUploading={setUploading}
              onSend={() => editForm.current?.requestSubmit()}
            />
            <div className={styles.editActions}>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={cancelEditing}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={busy || uploading > 0 || !content.trim()}
              >
                <Check size={14} />
                Guardar
              </Button>
            </div>
          </form>
        ) : (
          <div className={styles.messageContent}>
            <MarkdownContent>{comment.content}</MarkdownContent>
          </div>
        )}
        <div className={styles.messageFooter}>
          {edited && (
            <span
              title={`Editado el ${fullDate.format(new Date(comment.updatedAt))} a las ${shortTime.format(new Date(comment.updatedAt))}`}
            >
              editado
            </span>
          )}
          <time dateTime={comment.createdAt} title={fullTimestamp}>
            {shortTime.format(new Date(comment.createdAt))}
          </time>
          {own && (
            <span
              className={styles.delivery}
              aria-label={pending ? "Enviando" : "Enviado"}
              title={pending ? "Enviando…" : "Enviado"}
            >
              {pending ? <Clock3 size={12} /> : <Check size={15} />}
            </span>
          )}
        </div>
      </div>
    </article>
  );
}
