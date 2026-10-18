"use client";

import Markdown, { type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import { Children, isValidElement, memo, useMemo } from "react";
import { youtubeUrl } from "@/lib/files";
import { parseImageTitle } from "@/lib/image-formatting";
import type { EntityRef } from "@/lib/types";
import { parseDiagramReference } from "@/lib/documents";
import { DocumentDiagramPreview } from "./diagram-preview-loader";
import { useImagePreview } from "./image-preview";

export const MarkdownContent = memo(function MarkdownContent({
  children,
  compact = false,
  diagramScope,
}: {
  children: string;
  compact?: boolean;
  diagramScope?: EntityRef;
}) {
  const openImage = useImagePreview();
  const components = useMemo<Components>(
    () => ({
      p: ({ children }) => {
        const nodes = Children.toArray(children);
        const first = nodes.length === 1 ? nodes[0] : null;
        const url =
          typeof first === "string"
            ? first.trim()
            : isValidElement<{ href?: string }>(first)
              ? first.props.href
              : undefined;
        const reference = diagramScope && !compact ? parseDiagramReference(url) : null;
        if (reference && diagramScope) return <DocumentDiagramPreview scope={diagramScope} projectId={reference.projectId} diagramId={reference.diagramId} />;
        const embed = !compact && url ? youtubeUrl(url) : null;
        return embed ? (
          <div className="youtube-video">
            <iframe
              src={embed}
              title="Video de YouTube"
              loading="lazy"
              allow="encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
            />
          </div>
        ) : (
          <p>{children}</p>
        );
      },
      a: ({ href, children }) =>
        compact ? (
          <span>{children}</span>
        ) : (
          <a href={href} target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        ),
      img: ({ src, alt, title }) =>
        compact ? (
          <span>{alt}</span>
        ) : typeof src === "string" &&
          /^\/api\/files\/[a-f0-9-]{36}\/content$/.test(src) ? (
          <button
            type="button"
            className="rich-image-trigger"
            style={{
              width: parseImageTitle(title).width ?? undefined,
              marginLeft:
                parseImageTitle(title).alignment === "left" ? 0 : "auto",
              marginRight:
                parseImageTitle(title).alignment === "right" ? 0 : "auto",
            }}
            aria-label={`Vista previa de ${alt || "imagen adjunta"}`}
            aria-haspopup="dialog"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              openImage(
                { src, name: alt || "Imagen adjunta" },
                event.currentTarget,
              );
            }}
          >
            <img
              src={src}
              alt={alt || "Imagen adjunta"}
              loading="lazy"
              title={parseImageTitle(title).title ?? undefined}
            />
          </button>
        ) : (
          <a
            href={typeof src === "string" ? src : undefined}
            target="_blank"
            rel="noopener noreferrer"
          >
            {alt || "Imagen"}
          </a>
        ),
    }),
    [compact, openImage, diagramScope],
  );
  return (
    <div className={compact ? "rich-text rich-text-compact" : "rich-text"}>
      <Markdown skipHtml remarkPlugins={[remarkBreaks]} components={components}>
        {children}
      </Markdown>
    </div>
  );
});
