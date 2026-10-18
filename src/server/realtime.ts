import { SignJWT } from "jose";
import { Rest } from "ably";
import { and, eq, sql } from "drizzle-orm";
import type { PostgresRepository } from "./postgres";
import { commentOutbox } from "./schema";
import { ablyConfig, commentsChannel } from "./realtime-config";
import { DomainError } from "./repository";

export async function commentsToken(taskId: string, userId: string) {
  const config = ablyConfig();
  if (!config)
    throw new DomainError(
      "La conexión en tiempo real no está configurada.",
      503,
    );
  const [keyId, secret] = config.key.split(":");
  const channel = commentsChannel(config.namespace, taskId, userId);
  return new SignJWT({
    "x-ably-clientId": userId,
    "x-ably-capability": JSON.stringify({ [channel]: ["subscribe"] }),
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT", kid: keyId })
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(new TextEncoder().encode(secret));
}

export type CommentEvent = { taskId: string; eventId: string };
export type CommentPublisher = (
  event: CommentEvent,
  recipients: string[],
) => Promise<void>;

export function ablyPublisher(): CommentPublisher | null {
  const config = ablyConfig();
  if (!config) return null;
  const client = new Rest({
    key: config.key,
    httpRequestTimeout: 4000,
    httpMaxRetryCount: 0,
    logLevel: 0,
  });
  return async (event, recipients) => {
    for (let offset = 0; offset < recipients.length; offset += 5) {
      await Promise.all(
        recipients.slice(offset, offset + 5).map((userId) =>
          client.channels
            .get(commentsChannel(config.namespace, event.taskId, userId))
            .publish({
              id: `${event.eventId}:0`,
              name: "comments.changed",
              data: event,
            }),
        ),
      );
    }
  };
}

// Claim briefly, publish outside the transaction, then acknowledge the exact
// generation. A concurrent comment replaces eventId, so an older ACK can't erase it.
export async function flushCommentEvents(
  repo: PostgresRepository,
  publisher?: CommentPublisher | null,
) {
  const publish = publisher === undefined ? ablyPublisher() : publisher;
  if (!publish) return { sent: 0, failed: 0 };
  const claimed = await repo.store.transaction(async () => {
    const result = await repo.store.db.execute<{
      taskId: string;
      eventId: string;
      attempts: number;
    }>(sql`
      update comment_outbox set "leaseUntil" = now() + interval '60 seconds', attempts = attempts + 1
      where "taskId" in (
        select "taskId" from comment_outbox where "availableAt" <= now()
        and ("leaseUntil" is null or "leaseUntil" < now())
        order by "availableAt" limit 10 for update skip locked
      ) returning "taskId", "eventId", attempts
    `);
    return result.rows;
  });
  let sent = 0,
    failed = 0;
  for (const event of claimed) {
    try {
      const recipients = await repo.commentRecipients(event.taskId);
      await publish(
        { taskId: event.taskId, eventId: event.eventId },
        recipients,
      );
      await repo.store.transaction(async () => {
        await repo.store.db
          .delete(commentOutbox)
          .where(
            and(
              eq(commentOutbox.taskId, event.taskId),
              eq(commentOutbox.eventId, event.eventId),
            ),
          );
      });
      sent++;
    } catch {
      failed++;
      await repo.store.transaction(async () => {
        await repo.store.db
          .update(commentOutbox)
          .set({
            leaseUntil: null,
            availableAt: new Date(
              Date.now() +
                Math.min(60_000, 1000 * 2 ** Math.min(event.attempts, 6)),
            ),
          })
          .where(
            and(
              eq(commentOutbox.taskId, event.taskId),
              eq(commentOutbox.eventId, event.eventId),
            ),
          );
      });
    }
  }
  return { sent, failed };
}
