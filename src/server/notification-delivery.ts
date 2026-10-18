import { randomUUID, timingSafeEqual, createECDH } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { Rest } from "ably";
import { SignJWT } from "jose";
import webpush from "web-push";
import type { PostgresRepository } from "./postgres";
import * as s from "./schema";
import { ablyConfig, notificationsChannel } from "./realtime-config";
import { DomainError, isDomainError } from "./repository";

export function pushConfig(
  env: Record<string, string | undefined> = process.env,
) {
  const publicKey = env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  const subject = env.VAPID_SUBJECT?.trim();
  if (!publicKey && !privateKey) return null;
  if (
    !publicKey ||
    !privateKey ||
    !subject ||
    Buffer.from(publicKey, "base64url").length !== 65 ||
    Buffer.from(privateKey, "base64url").length !== 32 ||
    !/^(mailto:|https:\/\/)/.test(subject)
  )
    throw new Error(
      "Configura claves VAPID válidas y VAPID_SUBJECT (mailto: o https://).",
    );
  try {
    const identity = new URL(subject);
    if (
      !(identity.protocol === "https:" && identity.hostname) &&
      !(identity.protocol === "mailto:" && identity.pathname.includes("@"))
    )
      throw Error();
    const key = createECDH("prime256v1");
    key.setPrivateKey(Buffer.from(privateKey, "base64url"));
    if (
      !timingSafeEqual(key.getPublicKey(), Buffer.from(publicKey, "base64url"))
    )
      throw Error();
  } catch {
    throw new Error("El par de claves VAPID o VAPID_SUBJECT no es válido.");
  }
  return { publicKey, privateKey, subject };
}
export function workerAuthorized(
  request: Request,
  secret = process.env.NOTIFICATION_WORKER_SECRET,
) {
  if (!secret || secret.length < 32) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
export async function notificationToken(userId: string) {
  const config = ablyConfig();
  if (!config) throw new DomainError("Tiempo real no configurado.", 503);
  const [kid, secret] = config.key.split(":");
  return new SignJWT({
    "x-ably-clientId": userId,
    "x-ably-capability": JSON.stringify({
      [notificationsChannel(config.namespace, userId)]: ["subscribe"],
    }),
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT", kid })
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(new TextEncoder().encode(secret));
}
type Delivery = typeof s.notificationDeliveries.$inferSelect;
type Subscription = typeof s.pushSubscriptions.$inferSelect;
export type NotificationTransports = {
  invalidate(
    userId: string,
    eventId: string,
    notificationId: string | null,
  ): Promise<void>;
  push(
    subscription: Subscription,
    notificationId: string,
    ttl: number,
  ): Promise<void>;
};
export function notificationTransports(): NotificationTransports {
  const config = ablyConfig();
  const client = config
    ? new Rest({
        key: config.key,
        httpRequestTimeout: 4000,
        httpMaxRetryCount: 0,
        logLevel: 0,
      })
    : null;
  const vapid = pushConfig();
  return {
    async invalidate(userId, eventId, notificationId) {
      if (!client || !config) throw Error("realtime-unconfigured");
      await client.channels
        .get(notificationsChannel(config.namespace, userId))
        .publish({
          id: `${eventId}:0`,
          name: "notifications.changed",
          data: { eventId, notificationId },
        });
    },
    async push(sub, notificationId, ttl) {
      if (!vapid) throw Error("push-unconfigured");
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        JSON.stringify({
          title: "Taskode",
          body: "Tienes una nueva notificación.",
          notificationId,
          url: `/notifications?open=${encodeURIComponent(notificationId)}`,
        }),
        {
          vapidDetails: vapid,
          TTL: ttl,
          timeout: 4000,
          topic: notificationId.replaceAll("-", "").slice(0, 32),
        },
      );
    },
  };
}

export async function flushNotificationDeliveries(
  repo: PostgresRepository,
  transports?: NotificationTransports,
  options: { now?: Date; budgetMs?: number } = {},
) {
  const send = transports ?? notificationTransports();
  const now = options.now ?? new Date(),
    started = Date.now();
  const result = { sent: 0, failed: 0, discarded: 0, pending: 0 };
  const budget = Math.min(options.budgetMs ?? 20_000, 40_000);
  // Unique lease generation prevents an old ACK from removing a newer claim.
  while (Date.now() - started < budget) {
    const leaseUntil = new Date(Date.now() + 60_000);
    const claimed = await repo.store.transaction(async () => {
      await repo.store.db
        .delete(s.notificationDeliveries)
        .where(
          sql`${s.notificationDeliveries.expiresAt} <= ${now.toISOString()}::timestamptz`,
        );
      return repo.store.db
        .update(s.notificationDeliveries)
        .set({
          leaseUntil,
          attempts: sql`${s.notificationDeliveries.attempts} + 1`,
        })
        .where(
          sql`${s.notificationDeliveries.id} in (select id from notification_deliveries where "availableAt" <= ${now.toISOString()}::timestamptz and ("leaseUntil" is null or "leaseUntil" < now()) order by "availableAt", id limit 5 for update skip locked)`,
        )
        .returning();
    });
    if (!claimed.length) break;
    await Promise.all(
      claimed.map(async (job: Delivery) => {
        const match = and(
          eq(s.notificationDeliveries.id, job.id),
          eq(s.notificationDeliveries.leaseUntil, leaseUntil),
        );
        const discard = async () => {
          await repo.store.transaction(async () => {
            await repo.store.db.delete(s.notificationDeliveries).where(match);
          });
          result.discarded++;
        };
        try {
          if (job.notificationId) {
            try {
              await repo.notifications.get(
                { id: job.recipientId },
                job.notificationId,
              );
            } catch (e) {
              if (isDomainError(e) && [401, 403, 404].includes(e.status)) {
                await discard();
                return;
              }
              throw e;
            }
            if (
              !(await repo.notifications.deliveryValid(job.notificationId, now))
            ) {
              await discard();
              return;
            }
          }
          if (job.transport === "ably")
            await send.invalidate(job.recipientId, job.id, job.notificationId);
          else {
            if (!job.subscriptionId || !job.notificationId) {
              await discard();
              return;
            }
            const [sub] = await repo.store.db
              .select({ subscription: s.pushSubscriptions })
              .from(s.pushSubscriptions)
              .innerJoin(
                s.session,
                eq(s.session.id, s.pushSubscriptions.sessionId),
              )
              .where(
                and(
                  eq(s.pushSubscriptions.id, job.subscriptionId),
                  eq(s.pushSubscriptions.userId, job.recipientId),
                  sql`${s.session.expiresAt} > now()`,
                ),
              );
            if (!sub) {
              await discard();
              return;
            }
            try {
              await send.push(
                sub.subscription,
                job.notificationId,
                Math.max(
                  1,
                  Math.ceil((job.expiresAt.getTime() - now.getTime()) / 1000),
                ),
              );
            } catch (e) {
              const status = (e as { statusCode?: number }).statusCode;
              if (status === 404 || status === 410) {
                await repo.store.transaction(async () => {
                  await repo.store.db
                    .delete(s.pushSubscriptions)
                    .where(eq(s.pushSubscriptions.id, job.subscriptionId!));
                });
                result.discarded++;
                return;
              }
              throw e;
            }
          }
          await repo.store.transaction(async () => {
            await repo.store.db.delete(s.notificationDeliveries).where(match);
          });
          result.sent++;
        } catch {
          result.failed++;
          await repo.store.transaction(async () => {
            await repo.store.db
              .update(s.notificationDeliveries)
              .set({
                leaseUntil: null,
                availableAt: new Date(
                  now.getTime() +
                    Math.min(3600000, 1000 * 2 ** Math.min(job.attempts, 12)),
                ),
              })
              .where(match);
          });
        }
      }),
    );
  }
  const [count] = await repo.store.db
    .select({ count: sql<number>`count(*)::integer` })
    .from(s.notificationDeliveries);
  result.pending = count.count;
  return result;
}

export function validPushEndpoint(endpoint: string) {
  try {
    const u = new URL(endpoint);
    // Opaque endpoints are supplied by the browser. Limit outbound traffic to
    // browser push providers; never let subscriptions become an SSRF proxy.
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !u.port &&
      !u.hash &&
      (u.hostname === "fcm.googleapis.com" ||
        u.hostname === "web.push.apple.com" ||
        u.hostname.endsWith(".push.services.mozilla.com") ||
        u.hostname.endsWith(".notify.windows.com"))
    );
  } catch {
    return false;
  }
}
export async function subscribePush(
  repo: PostgresRepository,
  userId: string,
  sessionId: string,
  input: { endpoint: string; keys: { p256dh: string; auth: string } },
) {
  if (
    !validPushEndpoint(input.endpoint) ||
    Buffer.from(input.keys.p256dh, "base64url").length !== 65 ||
    Buffer.from(input.keys.auth, "base64url").length !== 16
  )
    throw new DomainError("La suscripción push no es válida.");
  return repo.store.transaction(async () => {
    const [session] = await repo.store.db
      .select()
      .from(s.session)
      .where(
        and(
          eq(s.session.id, sessionId),
          eq(s.session.userId, userId),
          sql`${s.session.expiresAt} > now()`,
        ),
      );
    if (!session) throw new DomainError("La sesión terminó.", 401);
    // Account switches can adopt the same browser endpoint only after login.
    const [previous] = await repo.store.db
      .select()
      .from(s.pushSubscriptions)
      .where(eq(s.pushSubscriptions.endpoint, input.endpoint));
    if (previous && previous.userId !== userId) {
      if (
        previous.p256dh !== input.keys.p256dh ||
        previous.auth !== input.keys.auth
      )
        throw new DomainError(
          "La suscripción no pertenece a este dispositivo.",
          403,
        );
      await repo.store.db
        .delete(s.pushSubscriptions)
        .where(eq(s.pushSubscriptions.id, previous.id));
    }
    if (previous?.userId === userId)
      await repo.store.db
        .update(s.pushSubscriptions)
        .set({ sessionId, ...input.keys })
        .where(eq(s.pushSubscriptions.id, previous.id));
    else
      await repo.store.db.insert(s.pushSubscriptions).values({
        id: randomUUID(),
        userId,
        sessionId,
        endpoint: input.endpoint,
        ...input.keys,
      });
  });
}
