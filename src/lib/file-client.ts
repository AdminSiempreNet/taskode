import { fileUrl } from "./files";
import type { TaskFile, EntityRef } from "./types";
import { entityColumns } from "./entities";
async function json(response: Response) {
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || "No se pudo cargar el archivo.");
  return data;
}
export async function uploadFile(
  file: File,
  projectId: string,
  taskId: string | EntityRef | undefined,
  purpose: "image" | "document",
  progress?: (value: number) => void,
) {
  const target = typeof taskId === "object" ? { scope: taskId } : { taskId };
  const upload = await json(
    await fetch("/api/files/uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        ...target,
        name: file.name || "imagen.png",
        size: file.size,
        purpose,
      }),
    }),
  );
  await new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", upload.url || `/api/files/uploads/${upload.id}`);
    request.setRequestHeader("Content-Type", upload.mimeType);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable)
        progress?.(Math.round((event.loaded / event.total) * 95));
    };
    request.onerror = () =>
      reject(new Error("No se pudo conectar al almacenamiento."));
    request.onload = () =>
      request.status >= 200 && request.status < 300
        ? resolve()
        : reject(
            new Error("No se pudo cargar el archivo. Vuelve a intentarlo."),
          );
    request.send(file);
  });
  const result = await json(
    await fetch(`/api/files/uploads/${upload.id}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(purpose === "document" ? target : {}),
    }),
  );
  progress?.(100);
  return {
    ...result,
    ...(purpose === "document" && typeof taskId === "object"
      ? entityColumns(taskId)
      : { taskId: purpose === "document" ? (taskId ?? null) : null }),
    projectId,
    purpose,
    createdAt: new Date().toISOString(),
    url: fileUrl(upload.id),
  } as TaskFile & { url: string };
}
