"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { AlignCenter, AlignLeft, AlignRight } from "lucide-react";
import type { ImageAlignment } from "@/lib/image-formatting";

const options = [
  {
    alignment: "left",
    label: "Alinear imagen a la izquierda",
    Icon: AlignLeft,
  },
  { alignment: "center", label: "Centrar imagen", Icon: AlignCenter },
  {
    alignment: "right",
    label: "Alinear imagen a la derecha",
    Icon: AlignRight,
  },
] as const;

export function ImageAlignmentControls({
  editor,
  selectedPosition,
  alignment,
  disabled,
}: {
  editor: Editor;
  selectedPosition: number | null;
  alignment: ImageAlignment;
  disabled: boolean;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);

  useLayoutEffect(() => {
    const element = menu.current;
    const root = element?.parentElement;
    const viewport = root?.querySelector<HTMLElement>(
      ".description-editor-content",
    );
    const selection = editor.state.selection;
    if (
      !element ||
      !root ||
      !viewport ||
      !(selection instanceof NodeSelection) ||
      selection.node.type.name !== "image"
    )
      return;
    const node = editor.view.nodeDOM(selection.from);
    const image =
      node instanceof HTMLImageElement
        ? node
        : node instanceof HTMLElement
          ? node.querySelector("img")
          : null;
    if (!image) return;
    let frame = 0;

    function updatePosition() {
      if (!element || !root || !viewport || !image) return;
      const imageBounds = image.getBoundingClientRect();
      const viewportBounds = viewport.getBoundingClientRect();
      const rootBounds = root.getBoundingClientRect();
      const padding = 6;
      if (
        imageBounds.bottom <= viewportBounds.top + padding ||
        imageBounds.top >= viewportBounds.bottom - padding
      ) {
        setPosition(null);
        return;
      }
      const width = element.offsetWidth;
      const height = element.offsetHeight;
      const above = imageBounds.top - height - 10;
      const top =
        above >= viewportBounds.top + padding
          ? above
          : Math.min(
              Math.max(imageBounds.top + 10, viewportBounds.top + padding),
              viewportBounds.bottom - height - padding,
            );
      const left = Math.max(
        viewportBounds.left + padding,
        Math.min(
          imageBounds.left + (imageBounds.width - width) / 2,
          viewportBounds.right - width - padding,
        ),
      );
      const next = {
        left: Math.round(left - rootBounds.left - root.clientLeft),
        top: Math.round(top - rootBounds.top - root.clientTop),
      };
      setPosition((previous) =>
        previous?.left === next.left && previous.top === next.top
          ? previous
          : next,
      );
    }

    function scheduleUpdate() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(updatePosition);
    }

    updatePosition();
    const observer = new ResizeObserver(scheduleUpdate);
    observer.observe(image);
    observer.observe(root);
    observer.observe(viewport);
    viewport.addEventListener("scroll", scheduleUpdate, { passive: true });
    editor.on("transaction", scheduleUpdate);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      viewport.removeEventListener("scroll", scheduleUpdate);
      editor.off("transaction", scheduleUpdate);
    };
  }, [editor, alignment, selectedPosition]);

  return (
    <div
      ref={menu}
      className="image-alignment-popover"
      role="group"
      aria-label="Alineación de imagen"
      style={
        position
          ? { left: position.left, top: position.top }
          : { visibility: "hidden" }
      }
    >
      {options.map(({ alignment: value, label, Icon }) => (
        <button
          key={value}
          type="button"
          title={label}
          aria-label={label}
          aria-pressed={alignment === value}
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() =>
            editor
              .chain()
              .focus(undefined, { scrollIntoView: false })
              .updateAttributes("image", { alignment: value })
              .run()
          }
        >
          <Icon size={16} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
