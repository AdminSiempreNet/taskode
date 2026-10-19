"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
type GuardedNavigation = CustomEvent<{ action: () => void }>;

export function useWorkspaceRouter() {
  const router = useRouter();
  const push = useCallback(
    (...args: Parameters<typeof router.push>) => {
      const action = () => router.push(...args);
      if (
        window.dispatchEvent(
          new CustomEvent("taskode:navigate", {
            cancelable: true,
            detail: { action },
          }),
        )
      )
        action();
    },
    [router],
  );
  return useMemo(() => ({ ...router, push }), [router, push]);
}

export function useUnsavedChanges(
  pending: boolean,
  busy: boolean,
  noun = "tarea",
) {
  const [leaveAction, setLeaveAction] = useState<(() => void) | null>(null);
  const allowedTraversal = useRef<string | null>(null);
  const requestNavigation = useCallback(
    (action: () => void, needsConfirmation = pending) => {
      if (needsConfirmation) setLeaveAction(() => action);
      else action();
    },
    [pending],
  );

  useEffect(() => {
    if (!pending) return;
    const requested = (event: Event) => {
      event.preventDefault();
      setLeaveAction(() => (event as GuardedNavigation).detail.action);
    };
    const linkClicked = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const anchor =
        event.target instanceof Element
          ? event.target.closest<HTMLAnchorElement>("a[href]")
          : null;
      if (!anchor || anchor.target || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (
        url.origin !== window.location.origin ||
        (url.pathname === window.location.pathname && url.search === window.location.search)
      )
        return;
      event.preventDefault();
      setLeaveAction(() => () => window.location.assign(url.href));
    };
    window.addEventListener("taskode:navigate", requested);
    document.addEventListener("click", linkClicked, true);
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
        (new URL(traversal.destination.url).pathname === window.location.pathname && new URL(traversal.destination.url).search === window.location.search)
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
        void navigation!
          .traverseTo(traversal.destination.key)
          .finished.catch(() => {
            allowedTraversal.current = null;
          });
      });
    };
    navigation?.addEventListener("navigate", navigate);
    return () => {
      window.removeEventListener("taskode:navigate", requested);
      document.removeEventListener("click", linkClicked, true);
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
              Si sales ahora, perderás los cambios pendientes de{" "}
              {noun === "tarea" || noun === "feature" ? "esta" : "este"} {noun}.
              Puedes seguir editando para guardarlos antes de salir.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>
              Seguir editando
            </AlertDialogCancel>
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
