"use client";
export async function fetchJSON<T = Record<string, unknown>>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  if (response.status === 401) {
    window.location.assign("/login");
    throw new Error("Tu sesión venció. Inicia sesión de nuevo.");
  }
  if (response.status === 204) return undefined as T;
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || "No se pudo completar la operación.");
  return data as T;
}
