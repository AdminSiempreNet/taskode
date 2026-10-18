"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Task, UserSummary } from "@/lib/types";
import { TaskCommentsClient, type ChatState } from "@/lib/task-comments-client";

export function useTaskComments(task: Task | undefined, user: UserSummary) {
  const client = useRef<TaskCommentsClient | null>(null);
  const initial = useRef({ task, user });
  initial.current = { task, user };
  const [state, setState] = useState<ChatState>({
    comments: task?.comments ?? [],
    connection: "connecting",
    sending: false,
    pending: null,
    error: "",
  });
  useEffect(() => {
    const { task, user } = initial.current;
    if (!task) {
      client.current = null;
      return;
    }
    const conversation = new TaskCommentsClient(
      task.id,
      task.comments,
      user,
      setState,
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
  }, [task?.id, user.id]);
  const mutate = useCallback(
    (command: unknown) =>
      client.current?.mutate(command) ?? Promise.resolve(null),
    [],
  );
  return { ...state, mutate };
}
