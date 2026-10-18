import { loadEnvConfig } from "@next/env";
import { randomUUID } from "node:crypto";
import { Realtime } from "ably";
import { ablyConfig, commentsChannel } from "../src/server/realtime-config";
import { ablyPublisher, commentsToken } from "../src/server/realtime";

loadEnvConfig(process.cwd(), !process.argv.includes("--production"));
async function main() {
  const config = ablyConfig();
  if (!config)
    throw new Error(
      "Añade ABLY_API_KEY y ABLY_CHANNEL_NAMESPACE a .env.local.",
    );
  if (
    process.argv.includes("--production") &&
    config.namespace !== "taskode-production"
  )
    throw new Error(
      "La comprobación de producción requiere ABLY_CHANNEL_NAMESPACE=taskode-production y su clave correspondiente.",
    );
  const taskId = randomUUID(),
    userId = `verification-${randomUUID()}`,
    eventId = randomUUID();
  const client = new Realtime({
    token: await commentsToken(taskId, userId),
    logLevel: 0,
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const received = new Promise<void>((resolve) => {
      void client.channels
        .get(commentsChannel(config.namespace, taskId, userId))
        .subscribe("comments.changed", (message) => {
          if (message.data.eventId === eventId) resolve();
        })
        .then(() => ablyPublisher()!({ taskId, eventId }, [userId]))
        .catch(() => {});
    });
    await Promise.race([
      received,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                "No se recibió el evento de prueba. Revisa la clave, Publish + Subscribe, la restricción de canales y la conexión a Internet.",
              ),
            ),
          15_000,
        );
      }),
    ]);
    console.log(
      `Ably verificado en ${config.namespace}: JWT privado, suscripción y publicación correctos. No se enviaron comentarios reales.`,
    );
  } finally {
    clearTimeout(timer);
    client.close();
  }
}
main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "No se pudo verificar Ably.",
  );
  process.exitCode = 1;
});
