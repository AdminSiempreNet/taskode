"use client";

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { Dialog } from "radix-ui";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { readPreference } from "@/lib/preferences";

const MIN_WIDTH = 240;
const MAX_WIDTH = 305;
const STORAGE_KEY = "taskode.sidebar-width";
const MOBILE_QUERY = "(max-width: 800px)";

function subscribeToViewport(onChange: () => void) {
  const media = window.matchMedia(MOBILE_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function getMobileSnapshot() {
  return window.matchMedia(MOBILE_QUERY).matches;
}

function getServerSnapshot() {
  return false;
}

function clampWidth(width: number) {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(width)));
}

function rememberWidth(width: number) {
  try {
    localStorage.setItem(STORAGE_KEY, String(width));
  } catch {
    // Resizing also works when browser storage is unavailable.
  }
}

export function ResizableSidebar({
  children,
  footer,
  collapsedActions,
  collapsed,
  edgeControl,
  mobileOpen,
  onMobileOpenChange,
  triggerRef,
}: {
  children: ReactNode;
  footer?: ReactNode;
  collapsedActions?: ReactNode;
  collapsed: boolean;
  edgeControl: ReactNode;
  mobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  const isMobile = useSyncExternalStore(
    subscribeToViewport,
    getMobileSnapshot,
    getServerSnapshot,
  );
  const [width, setWidth] = useState(MAX_WIDTH);
  const [resizing, setResizing] = useState(false);
  const widthRef = useRef(MAX_WIDTH);
  const drag = useRef<{ x: number; width: number } | null>(null);

  useEffect(() => {
    drag.current = null;
    setResizing(false);
    if (!isMobile) onMobileOpenChange(false);
  }, [isMobile, onMobileOpenChange]);

  useEffect(() => {
    try {
      const saved = readPreference(STORAGE_KEY);
      if (saved === null || !Number.isFinite(Number(saved))) return;
      const restored = clampWidth(Number(saved));
      widthRef.current = restored;
      setWidth(restored);
    } catch {
      // Keep the default width when browser storage is unavailable.
    }
  }, []);

  function updateWidth(next: number, remember = false) {
    const clamped = clampWidth(next);
    widthRef.current = clamped;
    setWidth(clamped);
    if (remember) rememberWidth(clamped);
  }

  function startResize(event: PointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, width: widthRef.current };
    setResizing(true);
  }

  function stopResize() {
    if (!drag.current) return;
    drag.current = null;
    setResizing(false);
    rememberWidth(widthRef.current);
  }

  function resizeWithKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 1 : 10;
    const next = {
      ArrowLeft: widthRef.current - step,
      ArrowRight: widthRef.current + step,
      Home: MIN_WIDTH,
      End: MAX_WIDTH,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    updateWidth(next, true);
  }

  if (isMobile) {
    return (
      <>
        <Dialog.Root open={mobileOpen} onOpenChange={onMobileOpenChange}>
          <Dialog.Portal>
            <Dialog.Overlay className="sidebar-drawer-overlay" />
            <Dialog.Content
              id="workspace-sidebar"
              className="sidebar sidebar-drawer"
              aria-describedby={undefined}
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                if (document.activeElement === document.body)
                  triggerRef.current?.focus();
              }}
            >
              <div className="sidebar-drawer-heading">
                <Dialog.Title>Navegación</Dialog.Title>
                <Dialog.Close asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Cerrar barra lateral"
                    title="Cerrar barra lateral"
                  >
                    <X size={18} />
                  </Button>
                </Dialog.Close>
              </div>
              {children}
              {footer}
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
        {!mobileOpen && collapsedActions && (
          <div className="sidebar-compact-actions">{collapsedActions}</div>
        )}
      </>
    );
  }

  return (
    <>
      <aside
        id="workspace-sidebar"
        className="sidebar"
        hidden={collapsed}
        aria-label="Navegación del proyecto"
        data-resizing={resizing || undefined}
        style={{ "--sidebar-width": `${width}px` } as CSSProperties}
      >
        {children}
        {!collapsed && footer}
        {!collapsed && (
          <div className="sidebar-edge">
            <div
              className="sidebar-resize-handle"
              role="separator"
              tabIndex={0}
              aria-label="Ancho de la barra lateral"
              aria-orientation="vertical"
              aria-controls="workspace-sidebar"
              aria-valuemin={MIN_WIDTH}
              aria-valuemax={MAX_WIDTH}
              aria-valuenow={width}
              aria-valuetext={`${width} píxeles`}
              title="Arrastra para ajustar el ancho. Usa las flechas o haz doble clic para ampliar al máximo."
              onPointerDown={startResize}
              onPointerMove={(event) => {
                if (drag.current)
                  updateWidth(drag.current.width + event.clientX - drag.current.x);
              }}
              onPointerUp={stopResize}
              onPointerCancel={stopResize}
              onLostPointerCapture={stopResize}
              onKeyDown={resizeWithKeyboard}
              onDoubleClick={() => updateWidth(MAX_WIDTH, true)}
            />
            {edgeControl}
          </div>
        )}
      </aside>
      {collapsed && (
        <>
          <div className="sidebar-edge sidebar-edge-collapsed">{edgeControl}</div>
          {collapsedActions && (
            <div className="sidebar-compact-actions">{collapsedActions}</div>
          )}
        </>
      )}
    </>
  );
}
