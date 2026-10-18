import { Node } from "@tiptap/core";
import { diagramReferencePath, parseDiagramReference } from "../lib/documents";
import type { EntityRef } from "../lib/types";

export const DiagramReference = Node.create({
  name: "diagramReference",
  priority: 100,
  group: "block",
  atom: true,
  draggable: true,
  addOptions: () => ({ scope: null as EntityRef | null }),
  addAttributes: () => ({
    projectId: {
      default: "",
      parseHTML: (element) => element.getAttribute("data-project-id"),
    },
    diagramId: {
      default: "",
      parseHTML: (element) => element.getAttribute("data-diagram-id"),
    },
    title: {
      default: "Diagrama",
      parseHTML: (element) => element.getAttribute("data-title"),
    },
  }),
  markdownTokenizer: {
    name: "diagramReference",
    level: "block",
    // Marked searches on source.slice(1); matching every '[' also splits images
    // into a literal '!' followed by a link. Only interrupt at a new paragraph.
    start(source: string) {
      const match =
        /\n[ \t]*\n(?=\[(?:\\.|[^\]\\\r\n])*\]\(\/projects\/[^ \t\r\n)]+\/diagrams\/[a-f0-9-]{36}\))/.exec(
          source,
        );
      return match ? match.index + match[0].length : -1;
    },
    tokenize(source: string) {
      const match =
        /^\[((?:\\.|[^\]\\\r\n])*)\]\((\/projects\/[^ \t\r\n)]+)\)[ \t]*(?:\r?\n(?=\r?\n|$)|$)/.exec(
          source,
        );
      const ref = match ? parseDiagramReference(match[2]) : null;
      return match && ref
        ? {
            type: "diagramReference",
            raw: match[0],
            ...ref,
            title: match[1].replace(/\\([\\[\]])/g, "$1"),
          }
        : undefined;
    },
  },
  parseMarkdown(token, helpers) {
    return helpers.createNode("diagramReference", {
      projectId: token.projectId,
      diagramId: token.diagramId,
      title: token.title,
    });
  },
  renderMarkdown(node) {
    const title = String(node.attrs?.title || "Diagrama")
      .replace(/[\\[\]]/g, "\\$&")
      .replace(/\r?\n/g, " ");
    return `[${title}](${diagramReferencePath(String(node.attrs?.projectId), String(node.attrs?.diagramId))})`;
  },
  parseHTML: () => [{ tag: "div[data-diagram-reference]" }],
  renderHTML({ node }) {
    return [
      "div",
      {
        "data-diagram-reference": "",
        "data-project-id": node.attrs.projectId,
        "data-diagram-id": node.attrs.diagramId,
        "data-title": node.attrs.title,
      },
      [
        "a",
        {
          href: diagramReferencePath(
            node.attrs.projectId,
            node.attrs.diagramId,
          ),
        },
        node.attrs.title,
      ],
    ];
  },
});
