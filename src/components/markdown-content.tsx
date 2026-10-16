import Markdown from "react-markdown";
import remarkBreaks from "remark-breaks";

export function MarkdownContent({
  children,
  compact = false,
}: {
  children: string;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "rich-text rich-text-compact" : "rich-text"}>
      <Markdown
        skipHtml
        remarkPlugins={[remarkBreaks]}
        components={{
          a: ({ href, children }) =>
            compact ? (
              <span>{children}</span>
            ) : (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            ),
          img: ({ src, alt }) =>
            compact ? (
              <span>{alt}</span>
            ) : (
              <a
                href={typeof src === "string" ? src : undefined}
                target="_blank"
                rel="noopener noreferrer"
              >
                {alt || "Imagen"}
              </a>
            ),
        }}
      >
        {children}
      </Markdown>
    </div>
  );
}
