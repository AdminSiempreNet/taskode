"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { HoverCard } from "radix-ui";
import { Node, type Editor } from "@tiptap/core";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { normalizeClientText } from "@/lib/clients";
import {
  mentionMarkdown,
  mentionQuery,
  parseMention,
  type MentionContext,
  type MentionOptions,
  type MentionRef,
} from "@/lib/mentions";
import { UserAvatar } from "./user-avatar";

const empty = { users: [], clients: [], tickets: [] } satisfies MentionOptions;
type Snapshot = { options: MentionOptions; loading: boolean; error: string };
const initial: Snapshot = { options: empty, loading: true, error: "" };
type Entry = {
  snapshot: Snapshot;
  listeners: Set<() => void>;
  started: boolean;
  generation: number;
  refresh: () => void;
};
const entries = new Map<string, Entry>();
function entryFor(key: string): Entry {
  let entry = entries.get(key);
  if (!entry) {
    const created: Entry = {
      snapshot: initial,
      listeners: new Set(),
      started: false,
      generation: 0,
      refresh: () => {
        const generation = ++created.generation;
        created.started = true;
        created.snapshot = { ...created.snapshot, loading: true, error: "" };
        created.listeners.forEach((fn) => fn());
        void fetch("/api/mentions/options", {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: key,
        })
          .then(async (r) => {
            const data = await r.json();
            if (!r.ok)
              throw Error(
                data.error || "No se pudieron consultar las menciones.",
              );
            return data as MentionOptions;
          })
          .then((options) => {
            if (generation !== created.generation) return;
            created.snapshot = { options, loading: false, error: "" };
          })
          .catch((error) => {
            if (generation !== created.generation) return;
            created.snapshot = {
              options: empty,
              loading: false,
              error: error.message,
            };
          })
          .finally(() => created.listeners.forEach((fn) => fn()));
      },
    };
    entries.set(key, created);
    entry = created;
  }
  return entry;
}
export function invalidateMentionOptions() {
  for (const entry of entries.values()) if (entry.listeners.size) entry.refresh();
}
export function useMentionOptions(context?: MentionContext) {
  const key = context ? JSON.stringify(context) : "";
  const entry = useMemo(
    () => (key && typeof window !== "undefined" ? entryFor(key) : null),
    [key],
  );
  const subscribe = useMemo(
    () => (fn: () => void) => {
      if (!entry) return () => {};
      if (!entries.has(key)) entries.set(key, entry);
      entry.listeners.add(fn);
      if (!entry.started) entry.refresh();
      return () => {
        entry.listeners.delete(fn);
        if (!entry.listeners.size && entries.get(key) === entry)
          entries.delete(key);
      };
    },
    [entry, key],
  );
  const state = useSyncExternalStore(
    subscribe,
    () => entry?.snapshot ?? initial,
    () => initial,
  );
  return { ...state, refresh: () => entry?.refresh() };
}

export function MentionDisplay({
  reference,
  label,
  context,
  compact = false,
}: {
  reference: MentionRef;
  label: string;
  context?: MentionContext;
  compact?: boolean;
}) {
  const { options } = useMentionOptions(context);
  const user =
    reference.type === "user"
      ? options.users.find((u) => u.id === reference.id)
      : undefined;
  const client =
    reference.type === "client"
      ? options.clients.find((c) => c.id === reference.id)
      : undefined;
  const ticket = reference.type === "ticket" ? options.tickets.find((ticket) => ticket.id === reference.id) : undefined;
  const name = user?.name ?? client?.name ?? ticket?.number ?? label;
  if (compact || (!user && !client && !ticket))
    return <span className={`mention mention-${reference.type}`}>{name}</span>;
  return (
    <HoverCard.Root openDelay={200} closeDelay={150}>
      <HoverCard.Trigger asChild>
        <span className={`mention mention-${reference.type}`} tabIndex={0}>
          {name}
        </span>
      </HoverCard.Trigger>
      <HoverCard.Portal>
        <HoverCard.Content
          className="mention-card"
          sideOffset={6}
          collisionPadding={12}
        >
          {user ? (
            <>
              <UserAvatar name={user.name} image={user.image} />
              <strong>{user.name}</strong>
              <span>{user.email}</span>
            </>
          ) : ticket ? (
            <>
              <strong>Ticket {ticket.number}</strong>
              <span>{ticket.clientName ?? "Sin cliente"}</span>
              {ticket.description && <span className="mention-ticket-description">{ticket.description}</span>}
              {ticket.url && <a href={ticket.url} target="_blank" rel="noopener noreferrer">Abrir ticket</a>}
            </>
          ) : (
            <>
              <strong>{client!.name}</strong>
              <span>
                {client!.cityName} · {client!.departmentName}
              </span>
            </>
          )}
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  );
}
function MentionNodeView({ node, extension }: NodeViewProps) {
  return (
    <NodeViewWrapper as="span" className="mention-node" contentEditable={false}>
      <MentionDisplay
        reference={{ type: node.attrs.type, id: node.attrs.id }}
        label={node.attrs.label}
        context={extension.options.getContext()}
      />
    </NodeViewWrapper>
  );
}
export const Mention = Node.create({
  name: "mention",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  priority: 1100,
  addOptions: () => ({
    getContext: () => undefined as MentionContext | undefined,
  }),
  addAttributes: () => ({
    type: { default: "user" },
    id: { default: "" },
    label: { default: "" },
  }),
  parseHTML: () => [
    {
      tag: "span[data-mention-id]",
      getAttrs: (element) => {
        const id = element.getAttribute("data-mention-id"),
          type = element.getAttribute("data-mention-type");
        return id && id.length <= 200 && (type === "user" || type === "client" || type === "ticket")
          ? { id, type, label: element.textContent }
          : false;
      },
    },
  ],
  renderHTML: ({ node }) => [
    "span",
    {
      "data-mention-id": node.attrs.id,
      "data-mention-type": node.attrs.type,
      class: `mention mention-${node.attrs.type}`,
    },
    node.attrs.label,
  ],
  renderText: ({ node }) => node.attrs.label,
  markdownTokenName: "link",
  parseMarkdown(token, helpers) {
    const ref = parseMention(token.href);
    return ref
      ? helpers.createNode("mention", {
          ...ref,
          label: helpers
            .parseInline(token.tokens ?? [])
            .map((n) => n.text ?? "")
            .join(""),
        })
      : helpers.applyMark("link", helpers.parseInline(token.tokens ?? []), {
          href: token.href,
          title: token.title || null,
        });
  },
  renderMarkdown: (node) =>
    mentionMarkdown(
      { type: node.attrs!.type, id: node.attrs!.id },
      node.attrs!.label,
    ),
  addNodeView: () => ReactNodeViewRenderer(MentionNodeView),
});

type Suggestion = {
  from: number;
  to: number;
  type: MentionRef["type"];
  query: string;
  left: number;
  top: number;
};
function suggestionAt(editor: Editor): Suggestion | null {
  const { selection } = editor.state;
  const { $from } = selection;
  if (
    !selection.empty ||
    !editor.isEditable ||
    editor.isActive("code") ||
    editor.isActive("codeBlock") ||
    editor.isActive("link")
  )
    return null;
  const before = $from.parent.textBetween(
    0,
    $from.parentOffset,
    "\n",
    "\ufffc",
  );
  const match = mentionQuery(before);
  if (!match) return null;
  const coords = editor.view.coordsAtPos($from.pos);
  return {
    from: $from.pos - match.query.length - 1,
    to: $from.pos,
    type: match.type,
    query: match.query,
    left: Math.max(12, Math.min(coords.left, window.innerWidth - 332)),
    top: Math.max(12, Math.min(coords.bottom + 5, window.innerHeight - 292)),
  };
}
export function MentionSuggestions({
  editor,
  context,
}: {
  editor: Editor | null;
  context?: MentionContext;
}) {
  const { options, loading, error, refresh } = useMentionOptions(context);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [active, setActive] = useState(0);
  const dismissed = useRef("");
  const listId = useId();
  const items = suggestion
    ? (suggestion.type === "user" ? options.users : suggestion.type === "client" ? options.clients : options.tickets.map((ticket) => ({ ...ticket, name: ticket.number })))
        .filter((item) =>
          normalizeClientText(
            `${item.name} ${"email" in item ? item.email : "number" in item ? `${item.clientName ?? ""} ${item.description} ${item.url ?? ""}` : `${item.cityName} ${item.departmentName}`}`,
          ).includes(normalizeClientText(suggestion.query)),
        )
        .slice(0, 30)
    : [];
  const current = useRef({ suggestion, items, active });
  current.current = { suggestion, items, active };
  useEffect(() => {
    if (!editor || !context) return;
    const update = () => {
      const next = editor.isFocused ? suggestionAt(editor) : null;
      const key = next ? `${next.from}:${next.to}:${next.query}` : "";
      if (key !== dismissed.current) dismissed.current = "";
      const previous = current.current.suggestion;
      if (
        next?.from !== previous?.from ||
        next?.query !== previous?.query ||
        next?.type !== previous?.type
      )
        setActive(0);
      setSuggestion(key && key === dismissed.current ? null : next);
    };
    const close = () => setSuggestion(null);
    const keydown = (event: KeyboardEvent) => {
      const state = current.current;
      if (
        !state.suggestion ||
        event.isComposing ||
        !["ArrowDown", "ArrowUp", "Enter", "Escape"].includes(event.key)
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === "Escape") {
        dismissed.current = `${state.suggestion.from}:${state.suggestion.to}:${state.suggestion.query}`;
        setSuggestion(null);
      } else if (event.key === "Enter") {
        const item =
          state.items[Math.min(state.active, state.items.length - 1)];
        if (item) select(item, state.suggestion);
        else setSuggestion(null);
      } else
        setActive(
          (v) =>
            (v +
              (event.key === "ArrowDown" ? 1 : -1) +
              Math.max(1, state.items.length)) %
            Math.max(1, state.items.length),
        );
    };
    editor.on("transaction", update);
    editor.on("focus", update);
    editor.on("blur", close);
    editor.view.dom.addEventListener("keydown", keydown, true);
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      editor.off("transaction", update);
      editor.off("focus", update);
      editor.off("blur", close);
      editor.view.dom.removeEventListener("keydown", keydown, true);
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [editor, JSON.stringify(context)]);
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    if (suggestion) {
      dom.setAttribute("aria-controls", listId);
      dom.setAttribute("aria-autocomplete", "list");
      if (items.length)
        dom.setAttribute(
          "aria-activedescendant",
          `${listId}-${Math.min(active, items.length - 1)}`,
        );
      else dom.removeAttribute("aria-activedescendant");
    } else {
      dom.removeAttribute("aria-controls");
      dom.removeAttribute("aria-autocomplete");
      dom.removeAttribute("aria-activedescendant");
    }
    document
      .getElementById(`${listId}-${active}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [editor, suggestion, listId, active, items.length]);
  function select(item: { id: string; name: string }, state: Suggestion) {
    editor
      ?.chain()
      .focus()
      .insertContentAt({ from: state.from, to: state.to }, [
        {
          type: "mention",
          attrs: { type: state.type, id: item.id, label: item.name },
        },
        { type: "text", text: " " },
      ])
      .run();
    setSuggestion(null);
  }
  if (!editor || !context || !suggestion) return null;
  return createPortal(
    <div
      className="mention-suggestions"
      style={{ left: suggestion.left, top: suggestion.top }}
      onPointerDown={(event) => event.preventDefault()}
      onMouseDown={(event) => event.preventDefault()}
    >
      <div
        id={listId}
        role="listbox"
        aria-label={
          suggestion.type === "user" ? "Mencionar usuario" : suggestion.type === "client" ? "Mencionar cliente" : "Mencionar ticket"
        }
      >
        {loading ? (
          <p role="status">Cargando…</p>
        ) : error ? (
          <p role="alert">
            {error}{" "}
            <button type="button" onClick={refresh}>
              Reintentar
            </button>
          </p>
        ) : !items.length ? (
          <p role="status">Sin resultados</p>
        ) : (
          items.map((item, index) => (
            <button
              type="button"
              key={item.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === Math.min(active, items.length - 1)}
              onClick={() => select(item, suggestion)}
            >
              {"email" in item && (
                <UserAvatar name={item.name} image={item.image} />
              )}
              <span>
                <strong>{item.name}</strong>
                <small>
                  {"email" in item
                    ? item.email
                    : "number" in item ? `${item.clientName ?? "Sin cliente"} · ${item.description || item.url || "Sin descripción"} · ${item.id.slice(-8)}` : `${item.cityName} · ${item.departmentName}`}
                </small>
              </span>
            </button>
          ))
        )}
      </div>
    </div>,
    editor.view.dom.closest('[role="dialog"]') ?? document.body,
  );
}
