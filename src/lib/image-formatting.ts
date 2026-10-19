export type ImageAlignment = "left" | "center" | "right";
export type ImageFormatting = {
  width: number | null;
  height: number | null;
  alignment: ImageAlignment;
  title: string | null;
};

export function imageDimension(value: unknown): number | null {
  const size = typeof value === "number" ? value : Number(value);
  return Number.isFinite(size) && size >= 24 && size <= 8192
    ? Math.round(size)
    : null;
}

export function imageAlignment(value: unknown): ImageAlignment {
  return value === "center" || value === "right" ? value : "left";
}

// Keep layout in a standard Markdown image title, without enabling raw HTML.
export function parseImageTitle(title?: string | null): ImageFormatting {
  const fallback: ImageFormatting = {
    width: null,
    height: null,
    alignment: "left",
    title: title || null,
  };
  const match =
    /^taskode-image:v1;width=(auto|\d+);height=(auto|\d+);align=(left|center|right)(?:;title=(.*))?$/.exec(
      title ?? "",
    );
  if (!match) return fallback;
  try {
    return {
      width: imageDimension(match[1]),
      height: imageDimension(match[2]),
      alignment: imageAlignment(match[3]),
      title: match[4] ? decodeURIComponent(match[4]) : null,
    };
  } catch {
    return fallback;
  }
}

export function serializeImageTitle(attributes: Record<string, unknown>) {
  const width = imageDimension(attributes.width);
  const height = imageDimension(attributes.height);
  const alignment = imageAlignment(attributes.alignment);
  const title = typeof attributes.title === "string" ? attributes.title : "";
  if (!width && !height && alignment === "left") return title;
  return `taskode-image:v1;width=${width ?? "auto"};height=${height ?? "auto"};align=${alignment}${title ? `;title=${encodeURIComponent(title)}` : ""}`;
}
