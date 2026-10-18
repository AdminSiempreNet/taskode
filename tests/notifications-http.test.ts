import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeJwt } from "jose";
import {
  authenticatedRequest,
  authConfig,
  actor,
  addUser,
  createRepository,
} from "./helpers";
import {
  listNotifications,
  notificationDetail,
  notificationPreferences,
  getNotificationToken,
  processNotifications,
} from "../src/server/notification-http";
import { notificationsChannel } from "../src/server/realtime-config";

test("API de avisos exige sesión, valida preferencias y aísla el canal personal", async () => {
  const old = { ...process.env },
    repo = await createRepository();
  const base = "http://localhost:5010";
  Object.assign(globalThis, { taskodeRepository: repo });
  Object.assign(process.env, authConfig, {
    ABLY_API_KEY: "test.key:secret",
    ABLY_CHANNEL_NAMESPACE: "test",
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: "",
    VAPID_PRIVATE_KEY: "",
  });
  try {
    const other = await addUser(repo, "api-other");
    const projectId = (
      await repo.execute(
        {
          type: "project.create",
          name: "API",
          description: "",
          icon: "P",
          color: "#059669",
        },
        actor,
      )
    ).createdId!;
    await repo.execute(
      { type: "project.team.add", projectId, userId: other.id },
      actor,
    );
    const w = await repo.getWorkspace(actor);
    await repo.execute(
      {
        type: "task.create",
        projectId,
        featureId: w.features[0].id,
        statusId: w.statuses[0].id,
        title: "Privada",
        description: "",
        priority: "medium",
        dueDate: null,
        labels: [],
        leaderId: other.id,
      },
      actor,
    );
    assert.equal(
      (await listNotifications(new Request(base + "/api/notifications")))
        .status,
      401,
    );
    const listed = await listNotifications(
      await authenticatedRequest(
        base + "/api/notifications",
        undefined,
        other.id,
      ),
    );
    assert.match(listed.headers.get("cache-control")!, /no-store/);
    const snapshot = await listed.json();
    assert.equal(snapshot.unreadCount, 1);
    assert.equal(
      snapshot.realtime.channel,
      notificationsChannel("test", other.id),
    );
    const detail = { params: Promise.resolve({ id: snapshot.items[0].id }) };
    assert.equal(
      (
        await notificationDetail(
          await authenticatedRequest(base + "/api/notifications/id"),
          detail,
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await listNotifications(
          await authenticatedRequest(base + "/api/notifications?limit=500"),
        )
      ).status,
      400,
    );
    const token = await getNotificationToken(
      await authenticatedRequest(
        base + "/api/notifications/token",
        { method: "POST" },
        other.id,
      ),
    );
    const claims = decodeJwt(await token.text());
    assert.deepEqual(JSON.parse(claims["x-ably-capability"] as string), {
      [notificationsChannel("test", other.id)]: ["subscribe"],
    });
    const save = (input: unknown, origin = base) =>
      authenticatedRequest(
        base + "/api/notification-preferences",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Origin: origin },
          body: JSON.stringify(input),
        },
        other.id,
      );
    assert.equal(
      (
        await notificationPreferences(
          await save({ offsets: [15, 60, 1440, 4320], dateOnlyTime: "08:00" }),
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await notificationPreferences(
          await save(
            { offsets: [], dateOnlyTime: "08:00" },
            "https://evil.test",
          ),
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await notificationPreferences(
          await save({ offsets: [], dateOnlyTime: "09:30", userId: actor.id }),
        )
      ).status,
      200,
    );
    assert.deepEqual(await repo.notifications.preferences(other), {
      offsets: [],
      dateOnlyTime: "09:30",
    });
    assert.deepEqual(
      (await repo.notifications.preferences(actor)).offsets,
      [1440, 60],
    );
    assert.equal(
      (
        await processNotifications(
          new Request(base + "/api/internal/notifications/process", {
            method: "POST",
          }),
        )
      ).status,
      401,
    );
  } finally {
    for (const key of Object.keys(process.env))
      if (!(key in old)) delete process.env[key];
    Object.assign(process.env, old);
    Reflect.deleteProperty(globalThis, "taskodeRepository");
    await repo.close();
  }
});
