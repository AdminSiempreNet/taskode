export const DEFAULT_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const FILE_ACCEPT =
  ".doc,.docx,.xls,.xlsx,.pdf,.jpg,.jpeg,.png,.gif,.webp,.avif";
export const fileUrl = (id: string) => `/api/files/${id}/content`;
export const fileTypes: Record<string, string> = {
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
};
export function youtubeUrl(value: string) {
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol)) return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    let id: string | null = null;
    if (host === "youtu.be") id = url.pathname.slice(1);
    else if (
      ["youtube.com", "m.youtube.com", "youtube-nocookie.com"].includes(host)
    )
      id =
        url.pathname === "/watch"
          ? url.searchParams.get("v")
          : (/^\/(shorts|embed|live)\/([^/]+)$/.exec(url.pathname)?.[2] ??
            null);
    if (!id || !/^[\w-]{11}$/.test(id)) return null;
    return `https://www.youtube-nocookie.com/embed/${id}`;
  } catch {
    return null;
  }
}
