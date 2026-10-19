import { Marked, type Token } from "marked";
import { z } from "zod";
import { entityKindSchema, entityRefSchema } from "./validation";

const id = z.string().min(1).max(200);
export const mentionContextSchema = z.union([
  z.object({ scope: entityRefSchema }),
  z.object({
    draft: z.object({
      kind: entityKindSchema,
      projectId: id.optional(),
      featureId: id.optional(),
      leaderId: id.optional(),
      teamMemberIds: z.array(id).max(1000).optional(),
    }),
  }),
]);
export type MentionContext = z.infer<typeof mentionContextSchema>;
export type MentionRef = { type: "user" | "client" | "ticket"; id: string };
export type MentionUser = {
  id: string;
  name: string;
  email: string;
  image: string | null;
};
export type MentionClient = {
  id: string;
  name: string;
  cityName: string;
  departmentName: string;
};
export type MentionTicket = { id: string; number: string; description: string; url: string | null; clientName: string | null };
export type MentionOptions = { users: MentionUser[]; clients: MentionClient[]; tickets: MentionTicket[] };

export function mentionPath(ref: MentionRef) {
  return `/mentions/${ref.type === "user" ? "users" : ref.type === "client" ? "clients" : "tickets"}/${encodeURIComponent(ref.id)}`;
}
export function parseMention(href: unknown): MentionRef | null {
  if (typeof href !== "string") return null;
  const match = /^\/mentions\/(users|clients|tickets)\/([^/?#]+)$/.exec(href);
  if (!match) return null;
  try {
    const value = decodeURIComponent(match[2]);
    if (!value || value.length > 200 || /[\u0000-\u001f]/.test(value))
      return null;
    return { type: match[1] === "users" ? "user" : match[1] === "clients" ? "client" : "ticket", id: value };
  } catch {
    return null;
  }
}
export function mentionMarkdown(ref: MentionRef, label: string) {
  return `[${label.replace(/[\\`*_\[\]<>]/g, "\\$&").replace(/\r?\n/g, " ")}](${mentionPath(ref)})`;
}

export function mentionQuery(text: string) {
  const match =
    /(?:^|[^\p{L}\p{N}_/.:@#!-])([@#!])([\p{L}\p{N} ._-]{0,100})$/u.exec(text);
  if (!match) return null;
  const start = text.length - match[2].length - 1;
  const prefix = text.slice(0, start).split(/\s/).at(-1) ?? "";
  if (/(?:https?:\/\/|www\.)/i.test(prefix)) return null;
  return {
    type: match[1] === "@" ? ("user" as const) : match[1] === "#" ? ("client" as const) : ("ticket" as const),
    query: match[2],
    start,
  };
}

// Walk Markdown tokens, never source text: examples in code/images are not mentions.
export function contentMentions(content: string): MentionRef[] {
  const found = new Map<string, MentionRef>();
  const parser = new Marked();
  parser.walkTokens(parser.lexer(content), (token: Token) => {
    if (token.type !== "link") return;
    const ref = parseMention(token.href);
    if (ref) found.set(`${ref.type}:${ref.id}`, ref);
  });
  return [...found.values()];
}
