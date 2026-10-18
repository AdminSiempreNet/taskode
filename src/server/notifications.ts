import { randomUUID, createHash } from "node:crypto";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  lte,
  sql,
  type SQL,
} from "drizzle-orm";
import type { PostgresRepository } from "./postgres";
import * as s from "./schema";
import { DomainError } from "./repository";
import type { Actor } from "../lib/types";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  notificationPreferencesSchema,
  type NotificationItem,
  type NotificationsSnapshot,
  type NotificationPreferences,
} from "../lib/notifications";
import { reminderTimes, DEFAULT_TIME_ZONE } from "../lib/project-time";
import { ablyConfig, notificationsChannel } from "./realtime-config";

type Assignment = { leaderId: string; team: string[] };
const encodeCursor = (sequence: number) =>
  Buffer.from(JSON.stringify(sequence)).toString("base64url");
function cursor(value: string) {
  try {
    if (value.length > 600) throw Error();
    const v: unknown = JSON.parse(Buffer.from(value, "base64url").toString());
    if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 1)
      throw Error();
    return v;
  } catch {
    throw new DomainError("Cursor de notificaciones inválido.");
  }
}

export class NotificationsService {
  constructor(readonly repo: PostgresRepository) {}
  // Use the same task visibility and project membership rules as requireTask.
  access(userId: string): SQL {
    return sql`exists (select 1 from "user" viewer where viewer.id = ${userId}
      and (viewer.role = 'admin' or ${s.projects.leaderId} = ${userId}
        or exists (select 1 from ${s.projectTeamMembers} pm where pm."projectId" = ${s.projects.id} and pm."userId" = ${userId}))
      and (viewer.role = 'admin' or ${this.repo.taskVisibility({ id: userId })}))`;
  }
  private inbox(userId: string) {
    return and(eq(s.notifications.recipientId, userId), this.access(userId));
  }
  async list(
    actor: Actor,
    options: { filter?: string; cursor?: string; limit?: number } = {},
  ): Promise<NotificationsSnapshot> {
    await this.repo.currentUser(actor);
    const limit = options.limit ?? 30;
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 50 ||
      (options.filter && !["all", "unread"].includes(options.filter))
    )
      throw new DomainError("Filtro o tamaño de página inválido.");
    const page = options.cursor ? cursor(options.cursor) : null;
    return this.repo.store.snapshot(async () => {
      const rows = await this.repo.store.db
        .select({
          id: s.notifications.id,
          sequence: s.notifications.sequence,
          type: s.notifications.type,
          actorName: s.user.name,
          taskId: s.tasks.id,
          projectId: s.projects.id,
          projectName: s.projects.name,
          taskTitle: s.notifications.taskTitle,
          offsetMinutes: s.notifications.offsetMinutes,
          createdAt: s.notifications.createdAt,
          readAt: s.notifications.readAt,
        })
        .from(s.notifications)
        .innerJoin(s.tasks, eq(s.tasks.id, s.notifications.taskId))
        .innerJoin(s.projects, eq(s.projects.id, s.tasks.projectId))
        .leftJoin(s.user, eq(s.user.id, s.notifications.actorId))
        .where(
          and(
            this.inbox(actor.id),
            options.filter === "unread"
              ? isNull(s.notifications.readAt)
              : undefined,
            page ? sql`${s.notifications.sequence} < ${page}` : undefined,
          ),
        )
        .orderBy(desc(s.notifications.sequence))
        .limit(limit + 1);
      const [count] = await this.repo.store.db
        .select({ count: sql<number>`count(*)::integer` })
        .from(s.notifications)
        .innerJoin(s.tasks, eq(s.tasks.id, s.notifications.taskId))
        .innerJoin(s.projects, eq(s.projects.id, s.tasks.projectId))
        .where(and(this.inbox(actor.id), isNull(s.notifications.readAt)));
      const items: NotificationItem[] = rows.slice(0, limit).map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
        readAt: r.readAt?.toISOString() ?? null,
      }));
      const config = ablyConfig();
      return {
        items,
        unreadCount: count.count,
        nextCursor:
          rows.length > limit ? encodeCursor(rows[limit - 1].sequence) : null,
        through: rows[0] ? encodeCursor(rows[0].sequence) : null,
        realtime: {
          enabled: !!config,
          channel: config
            ? notificationsChannel(config.namespace, actor.id)
            : null,
        },
      };
    });
  }
  async get(actor: Actor, id: string) {
    await this.repo.store.ready;
    const [item] = await this.repo.store.db
      .select({
        taskId: s.notifications.taskId,
        projectId: s.tasks.projectId,
        readAt: s.notifications.readAt,
      })
      .from(s.notifications)
      .innerJoin(s.tasks, eq(s.tasks.id, s.notifications.taskId))
      .innerJoin(s.projects, eq(s.projects.id, s.tasks.projectId))
      .where(and(eq(s.notifications.id, id), this.inbox(actor.id)));
    if (!item)
      throw new DomainError(
        "La notificación no existe o no tienes acceso.",
        404,
      );
    return {
      id,
      taskId: item.taskId,
      projectId: item.projectId,
      readAt: item.readAt?.toISOString() ?? null,
    };
  }
  async read(
    actor: Actor,
    input: { id: string; read: boolean } | { through: string },
  ) {
    return this.repo.store.transaction(async () => {
      await this.repo.currentUser(actor);
      const through = "through" in input ? cursor(input.through) : null;
      if ("id" in input) await this.get(actor, input.id);
      const visible = this.repo.store.db
        .select({ id: s.notifications.id })
        .from(s.notifications)
        .innerJoin(s.tasks, eq(s.tasks.id, s.notifications.taskId))
        .innerJoin(s.projects, eq(s.projects.id, s.tasks.projectId))
        .where(
          and(
            this.inbox(actor.id),
            "id" in input
              ? eq(s.notifications.id, input.id)
              : lte(s.notifications.sequence, through!),
          ),
        );
      await this.repo.store.db
        .update(s.notifications)
        .set({ readAt: "read" in input && !input.read ? null : new Date() })
        .where(inArray(s.notifications.id, visible));
      await this.invalidate(actor.id);
    });
  }
  async preferences(actor: Actor): Promise<NotificationPreferences> {
    await this.repo.currentUser(actor);
    const [row] = await this.repo.store.db
      .select()
      .from(s.notificationPreferences)
      .where(eq(s.notificationPreferences.userId, actor.id));
    return row
      ? { offsets: row.offsets.map(Number), dateOnlyTime: row.dateOnlyTime }
      : {
          ...DEFAULT_NOTIFICATION_PREFERENCES,
          offsets: [...DEFAULT_NOTIFICATION_PREFERENCES.offsets],
        };
  }
  async savePreferences(actor: Actor, input: unknown, now = new Date()) {
    const parsed = notificationPreferencesSchema.safeParse(input);
    if (!parsed.success)
      throw new DomainError(
        "Selecciona hasta tres anticipaciones distintas y una hora válida.",
      );
    return this.repo.store.transaction(async () => {
      await this.repo.currentUser(actor);
      const fields = {
        userId: actor.id,
        offsets: parsed.data.offsets.map(String),
        dateOnlyTime: parsed.data.dateOnlyTime,
      };
      await this.repo.store.db
        .insert(s.notificationPreferences)
        .values(fields)
        .onConflictDoUpdate({
          target: s.notificationPreferences.userId,
          set: fields,
        });
      const ids = await this.repo.store.db
        .select({ id: s.tasks.id })
        .from(s.tasks)
        .where(
          sql`${s.tasks.leaderId} = ${actor.id} or exists (select 1 from ${s.taskTeamMembers} tm where tm."taskId" = ${s.tasks.id} and tm."userId" = ${actor.id})`,
        );
      await this.reconcile(
        ids.map((t) => t.id),
        now,
      );
      return parsed.data;
    });
  }
  async assignment(taskId: string): Promise<Assignment | null> {
    const [task] = await this.repo.store.db
      .select({ leaderId: s.tasks.leaderId })
      .from(s.tasks)
      .where(eq(s.tasks.id, taskId));
    if (!task) return null;
    const team = await this.repo.store.db
      .select()
      .from(s.taskTeamMembers)
      .where(eq(s.taskTeamMembers.taskId, taskId));
    return { leaderId: task.leaderId, team: team.map((r) => r.userId) };
  }
  async deliveryValid(notificationId: string, now = new Date()) {
    const [row] = await this.repo.store.db
      .select({
        notification: s.notifications,
        task: s.tasks,
        project: s.projects,
        status: s.statuses,
        preference: s.notificationPreferences,
        directMember: sql<boolean>`(${s.tasks.leaderId} = ${s.notifications.recipientId} or exists (select 1 from ${s.taskTeamMembers} member where member."taskId" = ${s.tasks.id} and member."userId" = ${s.notifications.recipientId}))`,
      })
      .from(s.notifications)
      .innerJoin(s.tasks, eq(s.tasks.id, s.notifications.taskId))
      .innerJoin(s.projects, eq(s.projects.id, s.tasks.projectId))
      .innerJoin(s.statuses, eq(s.statuses.id, s.tasks.statusId))
      .leftJoin(
        s.notificationPreferences,
        eq(s.notificationPreferences.userId, s.notifications.recipientId),
      )
      .where(eq(s.notifications.id, notificationId));
    if (!row) return false;
    const { notification: item, task, project, status } = row;
    if (item.type !== "reminder") return true;
    if (
      task.archived ||
      status.isDone ||
      !task.dueDate ||
      item.offsetMinutes === null
    )
      return false;
    if (!row.directMember) return false;
    const pref = row.preference
      ? {
          offsets: row.preference.offsets.map(Number),
          dateOnlyTime: row.preference.dateOnlyTime,
        }
      : DEFAULT_NOTIFICATION_PREFERENCES;
    if (!pref.offsets.includes(item.offsetMinutes)) return false;
    const times = reminderTimes(
      task.dueDate,
      task.dueTime,
      project.timeZone,
      item.offsetMinutes,
      pref.dateOnlyTime,
    );
    if (!times || times.expiresAt <= now) return false;
    const key = createHash("sha256")
      .update(
        JSON.stringify([
          task.id,
          item.recipientId,
          task.dueDate,
          task.dueTime,
          project.timeZone,
          item.offsetMinutes,
          times.scheduledFor.toISOString(),
        ]),
      )
      .digest("hex");
    return item.dedupKey === `reminder:${key}`;
  }
  async assigned(
    taskId: string,
    actor: Actor,
    previous: Assignment | null,
    now = new Date(),
  ) {
    const next = await this.assignment(taskId);
    if (!next) return;
    if (next.leaderId !== previous?.leaderId && next.leaderId !== actor.id)
      await this.create(
        taskId,
        next.leaderId,
        "assigned",
        actor.id,
        `assignment:${randomUUID()}`,
        null,
        now,
      );
    const existing = new Set(
      previous ? [previous.leaderId, ...previous.team] : [],
    );
    for (const userId of next.team)
      if (userId !== actor.id && !existing.has(userId))
        await this.create(
          taskId,
          userId,
          "shared",
          actor.id,
          `share:${randomUUID()}`,
          null,
          now,
        );
    const current = new Set([next.leaderId, ...next.team]);
    await this.accessChanged([...existing].filter((id) => !current.has(id)));
  }
  private async invalidate(
    userId: string,
    notificationId: string | null = null,
    expiresAt = new Date(Date.now() + 86400000),
    now = new Date(),
  ) {
    await this.repo.store.db.insert(s.notificationDeliveries).values({
      id: randomUUID(),
      recipientId: userId,
      notificationId,
      transport: "ably",
      expiresAt,
      availableAt: now,
    });
  }
  async accessChanged(userIds: string[]) {
    for (const userId of new Set(userIds)) await this.invalidate(userId);
  }
  private async create(
    taskId: string,
    userId: string,
    type: NotificationItem["type"],
    actorId: string | null,
    dedupKey: string,
    offsetMinutes: number | null,
    now: Date,
    expiresAt = new Date(now.getTime() + 86400000),
  ) {
    const [task] = await this.repo.store.db
      .select({ title: s.tasks.title })
      .from(s.tasks)
      .innerJoin(s.projects, eq(s.projects.id, s.tasks.projectId))
      .where(and(eq(s.tasks.id, taskId), this.access(userId)));
    if (!task)
      throw new DomainError("La tarea no existe o no tienes acceso.", 404);
    const [item] = await this.repo.store.db
      .insert(s.notifications)
      .values({
        id: randomUUID(),
        recipientId: userId,
        actorId,
        taskId,
        type,
        taskTitle: String(task.title),
        dedupKey,
        offsetMinutes,
        createdAt: now,
      })
      .onConflictDoNothing({ target: s.notifications.dedupKey })
      .returning();
    if (!item) return false;
    await this.invalidate(userId, item.id, expiresAt, now);
    const subscriptions = await this.repo.store.db
      .select({ id: s.pushSubscriptions.id })
      .from(s.pushSubscriptions)
      .innerJoin(s.session, eq(s.session.id, s.pushSubscriptions.sessionId))
      .where(
        and(
          eq(s.pushSubscriptions.userId, userId),
          sql`${s.session.expiresAt} > ${now.toISOString()}::timestamptz`,
        ),
      );
    for (const sub of subscriptions)
      await this.repo.store.db.insert(s.notificationDeliveries).values({
        id: randomUUID(),
        recipientId: userId,
        notificationId: item.id,
        subscriptionId: sub.id,
        transport: "push",
        expiresAt,
        availableAt: now,
      });
    return true;
  }
  // Reconciliation preserves already-scheduled due jobs, but never backfills a
  // newly enabled threshold. A unique durable key survives retries/restores.
  async reconcile(taskIds?: string[], now = new Date()) {
    if (taskIds && !taskIds.length) return;
    const records = await this.repo.store.db
      .select({
        task: {
          id: s.tasks.id,
          projectId: s.tasks.projectId,
          leaderId: s.tasks.leaderId,
          dueDate: s.tasks.dueDate,
          dueTime: s.tasks.dueTime,
          archived: s.tasks.archived,
        },
        project: {
          id: s.projects.id,
          leaderId: s.projects.leaderId,
          timeZone: s.projects.timeZone,
        },
        status: { isDone: s.statuses.isDone },
      })
      .from(s.tasks)
      .innerJoin(s.projects, eq(s.projects.id, s.tasks.projectId))
      .innerJoin(s.statuses, eq(s.statuses.id, s.tasks.statusId))
      .where(taskIds ? inArray(s.tasks.id, taskIds) : undefined);
    if (!records.length) return;
    const teams = await this.repo.store.db
      .select()
      .from(s.taskTeamMembers)
      .where(taskIds ? inArray(s.taskTeamMembers.taskId, taskIds) : undefined);
    const recipientIds = [
      ...new Set([
        ...records.map((r) => r.task.leaderId),
        ...teams.map((r) => r.userId),
      ]),
    ];
    const prefs = new Map(
      (
        await this.repo.store.db
          .select()
          .from(s.notificationPreferences)
          .where(inArray(s.notificationPreferences.userId, recipientIds))
      ).map((p) => [p.userId, p]),
    );
    const roles = new Map(
      (
        await this.repo.store.db
          .select({ id: s.user.id, role: s.user.role })
          .from(s.user)
          .where(inArray(s.user.id, recipientIds))
      ).map((u) => [u.id, u.role]),
    );
    const memberships = new Set(
      (
        await this.repo.store.db
          .select()
          .from(s.projectTeamMembers)
          .where(
            inArray(s.projectTeamMembers.projectId, [
              ...new Set(records.map((r) => r.project.id)),
            ]),
          )
      ).map((m) => JSON.stringify([m.projectId, m.userId])),
    );
    const jobs = await this.repo.store.db
      .select()
      .from(s.taskReminders)
      .where(taskIds ? inArray(s.taskReminders.taskId, taskIds) : undefined);
    const existing = new Set(jobs.map((j) => j.dedupKey));
    const wanted = new Set<string>();
    const newJobs: (typeof s.taskReminders.$inferInsert)[] = [];
    for (const { task, project, status } of records) {
      if (task.archived || status.isDone || !task.dueDate) continue;
      const users = new Set([
        task.leaderId,
        ...teams.filter((t) => t.taskId === task.id).map((t) => t.userId),
      ]);
      for (const userId of users) {
        // Every recipient is already a direct task participant. Validate their
        // project access in bulk, without an N+1 authorization query per job.
        if (
          roles.get(userId) !== "admin" &&
          project.leaderId !== userId &&
          !memberships.has(JSON.stringify([project.id, userId]))
        )
          continue;
        const pref = prefs.get(userId);
        for (const offset of pref
          ? pref.offsets.map(Number)
          : DEFAULT_NOTIFICATION_PREFERENCES.offsets) {
          const times = reminderTimes(
            task.dueDate,
            task.dueTime,
            project.timeZone || DEFAULT_TIME_ZONE,
            offset,
            pref?.dateOnlyTime ?? "08:00",
          );
          if (!times) continue;
          const key = createHash("sha256")
            .update(
              JSON.stringify([
                task.id,
                userId,
                task.dueDate,
                task.dueTime,
                project.timeZone,
                offset,
                times.scheduledFor.toISOString(),
              ]),
            )
            .digest("hex");
          wanted.add(key);
          if (!existing.has(key) && times.scheduledFor > now) {
            newJobs.push({
              id: randomUUID(),
              taskId: task.id,
              userId,
              offsetMinutes: offset,
              ...times,
              dedupKey: key,
            });
          }
        }
      }
    }
    for (let offset = 0; offset < newJobs.length; offset += 500)
      await this.repo.store.db
        .insert(s.taskReminders)
        .values(newJobs.slice(offset, offset + 500))
        .onConflictDoNothing();
    const canceled = jobs
      .filter((j) => !j.processedAt && !wanted.has(j.dedupKey))
      .map((j) => j.id);
    if (canceled.length)
      await this.repo.store.db
        .delete(s.taskReminders)
        .where(inArray(s.taskReminders.id, canceled));
  }
  async processReminders(now = new Date(), bootstrapTaskIds?: string[]) {
    return this.repo.store.transaction(async () => {
      await this.reconcile(bootstrapTaskIds, now);
      await this.repo.store.db
        .update(s.taskReminders)
        .set({ processedAt: now })
        .where(
          and(
            isNull(s.taskReminders.processedAt),
            lte(s.taskReminders.expiresAt, now),
          ),
        );
      // The store's cross-process write lock also serializes reconciliation.
      const jobs = await this.repo.store.db
        .select()
        .from(s.taskReminders)
        .where(
          sql`${s.taskReminders.id} in (
          select id from (
            select distinct on ("taskId", "userId") id, "expiresAt", "scheduledFor"
            from task_reminders where "processedAt" is null and "scheduledFor" <= ${now.toISOString()}::timestamptz
            order by "taskId", "userId", "scheduledFor" desc, id desc
          ) latest order by "expiresAt", "scheduledFor", id limit 50
        )`,
        )
        .orderBy(
          asc(s.taskReminders.expiresAt),
          asc(s.taskReminders.scheduledFor),
          asc(s.taskReminders.id),
        )
        .limit(50);
      const seen = new Set<string>();
      let created = 0;
      for (const job of jobs) {
        const group = `${job.taskId}:${job.userId}`;
        if (!seen.has(group) && job.expiresAt > now) {
          const inserted = await this.create(
            job.taskId,
            job.userId,
            "reminder",
            null,
            `reminder:${job.dedupKey}`,
            job.offsetMinutes,
            now,
            job.expiresAt,
          );
          if (inserted) created++;
        }
        seen.add(group);
        // Retire every older missed threshold, including those outside this batch.
        await this.repo.store.db
          .update(s.taskReminders)
          .set({ processedAt: now })
          .where(
            and(
              eq(s.taskReminders.taskId, job.taskId),
              eq(s.taskReminders.userId, job.userId),
              isNull(s.taskReminders.processedAt),
              lte(s.taskReminders.scheduledFor, now),
            ),
          );
      }
      return created;
    });
  }
}
