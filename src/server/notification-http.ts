import { after } from "next/server";
import { z } from "zod";
import { eq, and, asc, gt } from "drizzle-orm";
import { repository } from "./index";
import { requireActor, assertOrigin } from "./access";
import { getAuth } from "./auth";
import { DomainError, isDomainError } from "./repository";
import {
  flushNotificationDeliveries,
  notificationToken,
  pushConfig,
  subscribePush,
  workerAuthorized,
} from "./notification-delivery";
import { pushSubscriptions, tasks } from "./schema";
import { pruneOAuthData } from "./oauth-maintenance";
import { flushWorkspaceEvents } from "./realtime";

export const notificationHeaders = { "Cache-Control": "private, no-store" };
export function deliverNotificationEvents() {
  after(async () => {
    try {
      const result = await flushNotificationDeliveries(
        repository(),
        undefined,
        { budgetMs: 8000 },
      );
      if (result.failed)
        console.warn("Hay notificaciones pendientes de reintento.");
    } catch {
      console.warn("No se pudo procesar la cola de notificaciones.");
    }
  });
}
async function body(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new DomainError("Faltan los datos.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.length;
    if (size > 16_384) {
      await reader.cancel();
      throw new DomainError("Datos demasiado grandes.", 413);
    }
    chunks.push(chunk.value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const value = schema.safeParse(input);
  if (!value.success)
    throw new DomainError("Datos de notificaciones inválidos.");
  return value.data;
}
export function notificationsRoute(
  action: (request: Request) => Promise<unknown>,
) {
  return async (request: Request) => {
    try {
      if (request.method !== "GET") assertOrigin(request);
      const value = await action(request);
      return Response.json(value ?? { ok: true }, {
        headers: notificationHeaders,
      });
    } catch (error) {
      if (error instanceof SyntaxError)
        return Response.json(
          { error: "JSON inválido." },
          { status: 400, headers: notificationHeaders },
        );
      if (isDomainError(error) || error instanceof DomainError)
        return Response.json(
          { error: error.message },
          { status: error.status, headers: notificationHeaders },
        );
      console.warn("No se pudo completar la operación de notificaciones.");
      return Response.json(
        { error: "No se pudo completar la operación." },
        { status: 500, headers: notificationHeaders },
      );
    }
  };
}
export const listNotifications = notificationsRoute(async (request) => {
  const q = new URL(request.url).searchParams;
  return repository().notifications.list(await requireActor(request), {
    filter: q.get("filter") ?? "all",
    cursor: q.get("cursor") ?? undefined,
    limit: q.has("limit") ? Number(q.get("limit")) : undefined,
  });
});
export async function notificationDetail(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return notificationsRoute(async () => {
    const actor = await requireActor(request),
      { id } = await context.params;
    if (request.method === "PATCH") {
      const input = parse(z.object({ read: z.boolean() }), await body(request));
      await repository().notifications.read(actor, { id, ...input });
      deliverNotificationEvents();
    }
    return repository().notifications.get(actor, id);
  })(request);
}
export const readAllNotifications = notificationsRoute(async (request) => {
  const actor = await requireActor(request);
  const input = parse(
    z.object({ through: z.string().min(1).max(600) }),
    await body(request),
  );
  await repository().notifications.read(actor, input);
  deliverNotificationEvents();
});
export const notificationPreferences = notificationsRoute(async (request) => {
  const actor = await requireActor(request);
  const preferences =
    request.method === "PATCH"
      ? await repository().notifications.savePreferences(
          actor,
          await body(request),
        )
      : await repository().notifications.preferences(actor);
  const config = pushConfig();
  return {
    preferences,
    push: { enabled: !!config, publicKey: config?.publicKey ?? null },
  };
});
export const pushSubscription = notificationsRoute(async (request) => {
  const actor = await requireActor(request);
  if (request.method === "DELETE") {
    const { endpoint } = parse(
      z.object({ endpoint: z.string().max(4096) }),
      await body(request),
    );
    await repository().store.transaction(async () => {
      await repository()
        .store.db.delete(pushSubscriptions)
        .where(
          and(
            eq(pushSubscriptions.userId, actor.id),
            eq(pushSubscriptions.endpoint, endpoint),
          ),
        );
    });
    return;
  }
  if (!pushConfig())
    throw new DomainError(
      "Las notificaciones push no están configuradas.",
      503,
    );
  const input = parse(
    z.object({
      endpoint: z.string().max(4096),
      keys: z.object({
        p256dh: z.string().max(200),
        auth: z.string().max(100),
      }),
    }),
    await body(request),
  );
  const auth = await getAuth().instance.api.getSession({
    headers: request.headers,
  });
  if (!auth) throw new DomainError("La sesión terminó.", 401);
  await subscribePush(repository(), actor.id, auth.session.id, input);
});
export async function getNotificationToken(request: Request) {
  try {
    assertOrigin(request);
    const actor = await requireActor(request);
    return new Response(await notificationToken(actor.id), {
      headers: {
        ...notificationHeaders,
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  } catch (error) {
    if (isDomainError(error) || error instanceof DomainError)
      return Response.json(
        { error: error.message },
        { status: error.status, headers: notificationHeaders },
      );
    console.warn("No se pudo autorizar el canal de notificaciones.");
    return Response.json(
      { error: "No se pudo autorizar la conexión." },
      { status: 503, headers: notificationHeaders },
    );
  }
}
export async function processNotifications(request: Request) {
  if (!workerAuthorized(request))
    return Response.json(
      { error: "No autorizado." },
      { status: 401, headers: notificationHeaders },
    );
  try {
    const started = Date.now();
    const afterTask = new URL(request.url).searchParams.get("after");
    if (afterTask && afterTask.length > 200)
      return Response.json(
        { error: "Cursor inválido." },
        { status: 400, headers: notificationHeaders },
      );
    const batch = await repository()
      .store.db.select({ id: tasks.id })
      .from(tasks)
      .where(afterTask ? gt(tasks.id, afterTask) : undefined)
      .orderBy(asc(tasks.id))
      .limit(51);
    const reminders = await repository().notifications.processReminders(
      new Date(),
      batch.slice(0, 50).map((t) => t.id),
    );
    const delivery = await flushNotificationDeliveries(
      repository(),
      undefined,
      { budgetMs: Math.max(1000, 45000 - (Date.now() - started)) },
    );
    // Retries the board refreshes that failed right after their command.
    const workspace = await flushWorkspaceEvents(repository()).catch(() => {
      console.warn("No se pudieron reintentar los avisos de cambios en tareas.");
      return { sent: 0, failed: 0 };
    });
    // The worker runs every minute; OAuth cleanup only needs a quarter-hourly pass.
    if (!afterTask && new Date().getUTCMinutes() % 15 === 0)
      await pruneOAuthData(repository()).catch(() =>
        console.warn("No se pudo limpiar los datos OAuth vencidos."),
      );
    console.info("Procesamiento de notificaciones", {
      at: new Date().toISOString(),
      reminders,
      ...delivery,
      workspace,
    });
    return Response.json(
      {
        reminders,
        ...delivery,
        workspace,
        nextCursor: batch.length > 50 ? batch[49].id : null,
      },
      { headers: notificationHeaders },
    );
  } catch {
    console.warn("Falló el procesamiento de notificaciones.");
    return Response.json(
      { error: "No se pudo procesar la cola." },
      { status: 503, headers: notificationHeaders },
    );
  }
}
