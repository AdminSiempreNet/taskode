import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Actor } from "../lib/types";
import { authConfigured, getAuth } from "./auth";
import { repository } from "./index";
import { DomainError, isDomainError } from "./repository";

export async function getActor(request?: Request): Promise<Actor | null> {
  if (!authConfigured()) return null;
  await repository().store.ready;
  const session = await getAuth().instance.api.getSession({
    headers: request?.headers ?? (await headers()),
  });
  return session?.user ? { id: session.user.id } : null;
}
export async function requireActor(request?: Request): Promise<Actor> {
  const actor = await getActor(request);
  if (!actor) throw new DomainError("Inicia sesión para continuar.", 401);
  return actor;
}
export async function requirePageActor(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) redirect("/login");
  return actor;
}
export function assertOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const expected = new URL(
    process.env.BETTER_AUTH_URL || "http://localhost:5010",
  ).origin;
  try {
    if (new URL(origin).origin === expected) return;
  } catch {}
  throw new DomainError("Origen no permitido.", 403);
}
export function httpError(error: unknown) {
  if (isDomainError(error))
    return Response.json(
      { error: error.message },
      { status: error.status, headers: { "Cache-Control": "no-store" } },
    );
  console.error(error);
  return Response.json(
    { error: "No se pudo completar la operación." },
    { status: 500 },
  );
}
export function adminRoute<C>(
  handler: (request: Request, context: C) => Promise<Response>,
) {
  return async (request: Request, context?: C) => {
    try {
      if (!["GET", "HEAD"].includes(request.method)) assertOrigin(request);
      await repository().requireAdmin(await requireActor(request));
      return await handler(request, context as C);
    } catch (error) {
      return httpError(error);
    }
  };
}
