"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Task, UserSummary, EntityRef, TaskComment } from "@/lib/types";
import { TaskCommentsClient, type ChatState } from "@/lib/task-comments-client";

export function useTaskComments(task: Task | undefined, user: UserSummary) {
  return useEntityComments(
    task ? { kind: "task", id: task.id, projectId: task.projectId } : undefined,
    user,
    task?.comments ?? [],
    true,
  );
}
export function useEntityComments(
  scope: EntityRef | undefined,
  user: UserSummary,
  comments: TaskComment[] = [],
  legacy = false,
) {
  const client = useRef<TaskCommentsClient | null>(null);
  const initial = useRef({ scope, user, comments });
  initial.current = { scope, user, comments };
  const [state, setState] = useState<ChatState>({
    comments,
    connection: "connecting",
    sending: false,
    pending: null,
    error: "",
  });
  useEffect(() => {
    const { scope, user, comments } = initial.current;
    if (!scope) {
      client.current = null;
      return;
    }
    const conversation = new TaskCommentsClient(
      scope.id,
      comments,
      user,
      setState,
      legacy ? {} : { scope },
    );
    client.current = conversation;
    setState(conversation.state);
    conversation.start();
    const refresh = () => {
      if (document.visibilityState === "visible") void conversation.refresh();
    };
    window.addEventListener("online", refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      conversation.stop();
      if (client.current === conversation) client.current = null;
      window.removeEventListener("online", refresh);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [scope?.kind, scope?.id, scope?.projectId, user.id, legacy]);
  const mutate = useCallback(
    (command: unknown) =>
      client.current?.mutate(command) ?? Promise.resolve(null),
    [],
  );
  return { ...state, mutate };
}
