"use client";

import { useRef } from "react";
import { useTheme } from "next-themes";
import { Excalidraw, MainMenu } from "@excalidraw/excalidraw";
import type {
  ExcalidrawInitialDataState,
  ExcalidrawProps,
} from "@excalidraw/excalidraw/types";
import type { DiagramScene } from "@/lib/diagrams";
import "@excalidraw/excalidraw/index.css";

// Set before the editor mounts so fonts never require an external CDN.
if (typeof window !== "undefined")
  (
    window as Window & { EXCALIDRAW_ASSET_PATH?: string }
  ).EXCALIDRAW_ASSET_PATH = "/excalidraw/";

export default function DiagramCanvas({
  scene,
  readOnly,
  publicView = false,
  onChange,
  onReady,
}: {
  scene: DiagramScene;
  readOnly: boolean;
  publicView?: boolean;
  onChange?: (scene: DiagramScene) => void;
  onReady?: (scene: DiagramScene) => void;
}) {
  const { resolvedTheme } = useTheme();
  const initial = useRef({
    ...scene,
    scrollToContent: true,
  } as unknown as ExcalidrawInitialDataState);
  const interacted = useRef(false);
  const changed: ExcalidrawProps["onChange"] = (elements, appState, files) => {
    if (readOnly || !onChange) return;
    const visible = elements.filter((element) => !element.isDeleted);
    const used = new Set(
      visible
        .filter((element) => element.type === "image")
        .map((element) => element.fileId),
    );
    const value = {
      elements: visible as unknown as DiagramScene["elements"],
      appState: { viewBackgroundColor: appState.viewBackgroundColor },
      files: Object.fromEntries(
        Object.entries(files)
          .filter(([id]) => used.has(id as never))
          .map(([id, file]) => [
            id,
            {
              id: file.id,
              mimeType: file.mimeType,
              dataURL: file.dataURL,
              created: file.created,
            },
          ]),
      ) as DiagramScene["files"],
    };
    // Restoration, image loading and font measurement are not user edits.
    // Establish the baseline from the editor's normalized scene until input.
    if (!interacted.current && onReady) onReady(value);
    else onChange(value);
  };
  return (
    <div
      style={{ width: "100%", height: "100%" }}
      onPointerDownCapture={() => {
        interacted.current = true;
      }}
      onKeyDownCapture={() => {
        interacted.current = true;
      }}
      onPasteCapture={() => {
        interacted.current = true;
      }}
      onDropCapture={() => {
        interacted.current = true;
      }}
    >
      <Excalidraw
        initialData={initial.current}
        onChange={changed}
        langCode="es-ES"
        theme={resolvedTheme === "dark" ? "dark" : "light"}
        viewModeEnabled={readOnly}
        zenModeEnabled={publicView}
        handleKeyboardGlobally={false}
        aiEnabled={false}
        validateEmbeddable={() => false}
        onLinkOpen={
          publicView ? (_element, event) => event.preventDefault() : undefined
        }
        UIOptions={{
          canvasActions: {
            loadScene: false,
            saveToActiveFile: false,
            export: publicView ? false : {},
            saveAsImage: !publicView,
            toggleTheme: false,
          },
        }}
      >
        <MainMenu>
          {!publicView && (
            <>
              <MainMenu.DefaultItems.Export />
              <MainMenu.DefaultItems.SaveAsImage />
            </>
          )}
          <MainMenu.DefaultItems.ChangeCanvasBackground />
        </MainMenu>
      </Excalidraw>
    </div>
  );
}
