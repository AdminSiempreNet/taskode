// Explicit opt-in: exercises only channels for random, nonexistent test users.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import nextEnv from "@next/env";
import { Realtime, Rest } from "ably";
import { notificationToken } from "../src/server/notification-delivery.ts";
import {
  ablyConfig,
  notificationsChannel,
} from "../src/server/realtime-config.ts";
nextEnv.loadEnvConfig(process.cwd(), true);
test(
  "Ably real: JWT personal recibe invalidaciones y rechaza otros canales",
  { timeout: 25000 },
  async () => {
    const config = ablyConfig();
    assert.ok(config, "Configura ABLY_API_KEY para la prueba explícita.");
    const userId = `notification-test-${randomUUID()}`;
    const client = new Realtime({
      token: await notificationToken(userId),
      autoConnect: false,
      logLevel: 0,
    });
    try {
      const channel = client.channels.get(
        notificationsChannel(config.namespace, userId),
      );
      let resolve;
      const received = new Promise((done) => {
        resolve = done;
      });
      client.connect();
      await channel.subscribe("notifications.changed", (message) =>
        resolve(message.data),
      );
      const publisher = new Rest({
        key: config.key,
        logLevel: 0,
        httpRequestTimeout: 5000,
      });
      const eventId = randomUUID();
      await publisher.channels
        .get(channel.name)
        .publish({
          id: `${eventId}:0`,
          name: "notifications.changed",
          data: { eventId, notificationId: null },
        });
      const data = await Promise.race([
        received,
        new Promise((_, reject) =>
          setTimeout(() => reject(Error("timeout")), 8000).unref(),
        ),
      ]);
      assert.equal(data.eventId, eventId);
      await assert.rejects(
        client.channels
          .get(notificationsChannel(config.namespace, `other-${userId}`))
          .attach(),
      );
    } catch {
      throw Error("No se pudo verificar la entrega y el aislamiento con Ably.");
    } finally {
      client.close();
    }
  },
);
