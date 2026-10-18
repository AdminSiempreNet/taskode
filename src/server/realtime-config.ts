import { createHash } from "node:crypto";
import type { EntityKind } from "../lib/types";

export function ablyConfig(
  env: {
    ABLY_API_KEY?: string;
    ABLY_CHANNEL_NAMESPACE?: string;
    NODE_ENV?: string;
  } = process.env,
) {
  const key = env.ABLY_API_KEY?.trim();
  if (!key) return null;
  if (!/^[\w-]+\.[\w-]+:[A-Za-z0-9+/=_-]+$/.test(key))
    throw new Error("ABLY_API_KEY debe contener una API key completa de Ably.");
  const namespace =
    env.ABLY_CHANNEL_NAMESPACE ||
    (env.NODE_ENV === "production"
      ? "taskode-production"
      : "taskode-development");
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(namespace))
    throw new Error(
      "ABLY_CHANNEL_NAMESPACE debe contener de 1 a 64 letras, números, guiones o guiones bajos.",
    );
  return { key, namespace };
}

export function commentsChannel(
  namespace: string,
  taskId: string,
  userId: string,
  kind: EntityKind = "task",
) {
  // Hash both IDs to keep channel names bounded and prevent wildcard injection.
  const hash = (value: string) =>
    createHash("sha256").update(value).digest("hex");
  return `${namespace}:${kind}:${hash(taskId)}:user:${hash(userId)}`;
}

export function commentsRealtime(
  taskId: string,
  userId: string,
  kind: EntityKind = "task",
) {
  const config = ablyConfig();
  return {
    enabled: !!config,
    channel: config
      ? commentsChannel(config.namespace, taskId, userId, kind)
      : null,
  };
}
