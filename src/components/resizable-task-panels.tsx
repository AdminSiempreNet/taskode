"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { readPreference } from "@/lib/preferences";

const STORAGE_KEY = "taskode.comments-width";
const MIN_COMMENTS_WIDTH = 260;
const MAX_COMMENTS_WIDTH = 720;
const MIN_CONTENT_WIDTH = 320;

export function ResizableTaskPanels({
  children,
  comments,
  mobile,
}: {
  children: ReactNode;
  comments: ReactNode;
  mobile: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const commentsId = useId();
  const [availableWidth, setAvailableWidth] = useState(0);
  const [preferredWidth, setPreferredWidth] = useState<number | null>(null);
  const [resizing, setResizing] = useState(false);
  const drag = useRef<{ x: number; width: number } | null>(null);
  const maximum = Math.max(
    200,
    Math.min(MAX_COMMENTS_WIDTH, availableWidth - MIN_CONTENT_WIDTH),
  );
  const minimum = Math.min(MIN_COMMENTS_WIDTH, maximum);
  const width = Math.min(
    maximum,
    Math.max(minimum, Math.round(preferredWidth ?? availableWidth / 3)),
  );
  const widthRef = useRef(width);
  widthRef.current = width;

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const measure = () => setAvailableWidth(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    const saved = readPreference(STORAGE_KEY);
    if (saved !== null && Number.isFinite(Number(saved)) && Number(saved) > 0)
      setPreferredWidth(Number(saved));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (mobile) {
      drag.current = null;
      setResizing(false);
    }
  }, [mobile]);

  function remember(next: number | null) {
    try {
      if (next === null) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // The divider remains usable when browser storage is unavailable.
    }
  }

  function updateWidth(next: number, persist = false) {
    const clamped = Math.min(maximum, Math.max(minimum, Math.round(next)));
    widthRef.current = clamped;
    setPreferredWidth(clamped);
    if (persist) remember(clamped);
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
    remember(widthRef.current);
  }

  function resizeWithKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 1 : 10;
    const next = {
      ArrowLeft: widthRef.current + step,
      ArrowRight: widthRef.current - step,
      Home: minimum,
      End: maximum,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    updateWidth(next, true);
  }

  return (
    <div
      ref={container}
      className="task-detail-columns"
      data-resizing={resizing || undefined}
      style={
        availableWidth
          ? ({ "--comments-width": `${width}px` } as CSSProperties)
          : undefined
      }
    >
      {children}
      {!mobile && (
        <>
          <div
            className="task-comments-resize-handle"
            role="separator"
            tabIndex={0}
            aria-label="Ancho de los comentarios"
            aria-orientation="vertical"
            aria-controls={commentsId}
            aria-valuemin={minimum}
            aria-valuemax={maximum}
            aria-valuenow={width}
            aria-valuetext={`${width} píxeles`}
            title="Arrastra para ajustar los comentarios. Usa las flechas o haz doble clic para restablecer el ancho."
            onPointerDown={startResize}
            onPointerMove={(event) => {
              if (drag.current)
                updateWidth(
                  drag.current.width + drag.current.x - event.clientX,
                );
            }}
            onPointerUp={stopResize}
            onPointerCancel={stopResize}
            onLostPointerCapture={stopResize}
            onKeyDown={resizeWithKeyboard}
            onDoubleClick={() => {
              setPreferredWidth(null);
              remember(null);
            }}
          />
          <aside
            id={commentsId}
            className="task-comments"
            aria-label="Comentarios de la tarea"
          >
            {comments}
          </aside>
        </>
      )}
    </div>
  );
}
