"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// The Navigation API is not yet included in this project's DOM typings.
type BrowserNavigation = EventTarget & {
  traverseTo: (key: string) => { finished: Promise<unknown> };
};
type TraversalEvent = Event & {
  navigationType: string;
  destination: { key: string; url: string; sameDocument: boolean };
};

export function useUnsavedChanges(pending: boolean, busy: boolean) {
  const [leaveAction, setLeaveAction] = useState<(() => void) | null>(null);
  const allowedTraversal = useRef<string | null>(null);
  const requestNavigation = useCallback(
    (action: () => void) => {
      if (pending) setLeaveAction(() => action);
      else action();
    },
    [pending],
  );

  useEffect(() => {
    if (!pending) return;
    const beforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", beforeUnload);

    const navigation = (window as Window & { navigation?: BrowserNavigation })
      .navigation;
    const navigate = (event: Event) => {
      const traversal = event as TraversalEvent;
      if (
        traversal.navigationType !== "traverse" ||
        !traversal.cancelable ||
        !traversal.destination.sameDocument ||
        new URL(traversal.destination.url).pathname === window.location.pathname
      )
        return;
      if (allowedTraversal.current === traversal.destination.key) {
        allowedTraversal.current = null;
        return;
      }
      // Stop browser Back/Forward before Next.js changes the route.
      traversal.preventDefault();
      setLeaveAction(() => () => {
        allowedTraversal.current = traversal.destination.key;
        void navigation!.traverseTo(traversal.destination.key).finished.catch(() => {
          allowedTraversal.current = null;
        });
      });
    };
    navigation?.addEventListener("navigate", navigate);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      navigation?.removeEventListener("navigate", navigate);
      allowedTraversal.current = null;
    };
  }, [pending]);

  return {
    requestNavigation,
    leaveDialog: (
      <AlertDialog
        open={!!leaveAction}
        onOpenChange={(open) => {
          if (!open && !busy) setLeaveAction(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hay cambios sin guardar</AlertDialogTitle>
            <AlertDialogDescription>
              Si sales ahora, perderás los cambios pendientes de esta tarea.
              Puedes seguir editando para guardarlos antes de salir.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Seguir editando</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={() => {
                setLeaveAction(null);
                leaveAction?.();
              }}
            >
              Salir sin guardar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    ),
  };
}
