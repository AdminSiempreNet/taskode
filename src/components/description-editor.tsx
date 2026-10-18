"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createMarkdownParser } from "@/lib/markdown-parser";
import {
  EditorContent,
  ReactNodeViewRenderer,
  useEditor,
  useEditorState,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { DescriptionImage } from "./description-image";
import { ImageAlignmentControls } from "./image-alignment-controls";
import { imageAlignment } from "@/lib/image-formatting";
import { imagePasteExtension, MarkdownYoutube } from "./media-extensions";
import { toast } from "sonner";
import {
  GitBranch,
  Bold,
  Check,
  Code,
  Italic,
  Link2,
  List,
  ListOrdered,
  Quote,
  Redo2,
  Undo2,
  Unlink,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MarkdownContent } from "./markdown-content";
import type { EntityRef } from "@/lib/types";
import { DiagramReference } from "./diagram-reference";
import { DiagramReferenceView } from "./diagram-reference-view";
import { DocumentDiagramPicker } from "./document-diagram-picker";

export function DescriptionEditor({
  value,
  onChange,
  editing,
  setEditing,
  disabled,
  uploadImage,
  onUploadingChange,
  diagramScope,
  label = "Descripción de la tarea",
}: {
  value: string;
  onChange: (value: string) => void;
  editing: boolean;
  setEditing: (value: boolean) => void;
  disabled: boolean;
  uploadImage?: (file: File) => Promise<string>;
  onUploadingChange?: (count: number) => void;
  label?: string;
  diagramScope?: EntityRef;
}) {
  const lastValue = useRef(value);
  const uploads = useRef({ uploadImage, onUploadingChange });
  uploads.current = { uploadImage, onUploadingChange };
  const [uploading, setUploading] = useState(0);
  const root = useRef<HTMLElement>(null);
  const [diagramPicker, setDiagramPicker] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [linkError, setLinkError] = useState("");
  const scrollTop = useRef(0);
  const pendingAction = useRef<(() => void) | null>(null);
  const diagramInsertion = useRef<number | null>(null);
  const markdownParser = useMemo(createMarkdownParser, []);
  const clickPosition = useRef<{ left: number; top: number } | null>(null);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        underline: false,
        trailingNode: false,
        link: { openOnClick: false, autolink: true },
      }),
      Markdown.configure({
        marked: markdownParser,
        markedOptions: { breaks: true },
      }),
      ...(diagramScope
        ? [
            DiagramReference.extend({
              addNodeView() {
                return ReactNodeViewRenderer(DiagramReferenceView);
              },
            }).configure({ scope: diagramScope }),
          ]
        : []),
      DescriptionImage,
      MarkdownYoutube,
      imagePasteExtension(
        (file) =>
          uploads.current.uploadImage
            ? uploads.current.uploadImage(file)
            : Promise.reject(
                new Error("No hay almacenamiento disponible para este editor."),
              ),
        (count) => {
          setUploading(count);
          uploads.current.onUploadingChange?.(count);
        },
        (message) => toast.error(message),
      ),
    ],
    content: value,
    contentType: "markdown",
    immediatelyRender: false,
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-label": label,
        "aria-multiline": "true",
        class: "rich-text description-writing",
      },
    },
    onUpdate: ({ editor }) => {
      const next = editor.getMarkdown();
      if (next.length > 30000) {
        editor.commands.setContent(lastValue.current, {
          contentType: "markdown",
          emitUpdate: false,
        });
        toast.error("El contenido admite hasta 30.000 caracteres.");
        return;
      }
      lastValue.current = next;
      onChange(next);
    },
  });
  const state = useEditorState({
    editor,
    selector: ({ editor }) => ({
      bold: editor?.isActive("bold") ?? false,
      italic: editor?.isActive("italic") ?? false,
      bulletList: editor?.isActive("bulletList") ?? false,
      orderedList: editor?.isActive("orderedList") ?? false,
      blockquote: editor?.isActive("blockquote") ?? false,
      code: editor?.isActive("code") ?? false,
      link: editor?.isActive("link") ?? false,
      image: editor?.isActive("image") ?? false,
      imagePosition: editor?.isActive("image")
        ? editor.state.selection.from
        : null,
      imageAlignment: editor?.getAttributes("image").alignment as
        string | undefined,
      style: editor?.isActive("heading", { level: 2 })
        ? "h2"
        : editor?.isActive("heading", { level: 3 })
          ? "h3"
          : "p",
      canUndo: editor?.can().undo() ?? false,
      canRedo: editor?.can().redo() ?? false,
    }),
  });
  useEffect(() => {
    if (editor && value !== lastValue.current) {
      editor.commands.setContent(value, {
        contentType: "markdown",
        emitUpdate: false,
      });
      lastValue.current = value;
    }
  }, [editor, value]);
  useEffect(() => {
    if (!editor) return;
    editor.setEditable(editing && !disabled, false);
    const viewport = root.current?.querySelector<HTMLElement>(
      editing ? ".description-editor-content" : ".description-rendered",
    );
    if (viewport) viewport.scrollTop = scrollTop.current;
    if (editing && !disabled) {
      if (clickPosition.current) {
        const position = editor.view.posAtCoords(clickPosition.current);
        if (position) editor.commands.setTextSelection(position.pos);
        clickPosition.current = null;
      }
      const action = pendingAction.current;
      pendingAction.current = null;
      if (action) action();
      else editor.commands.focus(undefined, { scrollIntoView: false });
    } else {
      setLinkOpen(false);
    }
  }, [editor, editing, disabled]);
  useEffect(() => {
    if (!editing) return;
    const outside = (event: PointerEvent) => {
      if (
        root.current &&
        event.target instanceof Node &&
        !(
          event.target instanceof Element &&
          event.target.closest("[data-image-preview], [data-document-picker]")
        ) &&
        !root.current.contains(event.target)
      )
        setEditing(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [editing, setEditing]);
  function startEditing(action?: () => void) {
    if (!editor || disabled) return;
    if (editing) action?.();
    else {
      pendingAction.current = action ?? null;
      setEditing(true);
    }
  }
  const controls = [
    {
      label: "Negrita",
      icon: Bold,
      active: state?.bold,
      run: () => editor?.chain().focus().toggleBold().run(),
    },
    {
      label: "Cursiva",
      icon: Italic,
      active: state?.italic,
      run: () => editor?.chain().focus().toggleItalic().run(),
    },
    {
      label: "Lista con viñetas",
      icon: List,
      active: state?.bulletList,
      run: () => editor?.chain().focus().toggleBulletList().run(),
    },
    {
      label: "Lista numerada",
      icon: ListOrdered,
      active: state?.orderedList,
      run: () => editor?.chain().focus().toggleOrderedList().run(),
    },
    {
      label: "Cita",
      icon: Quote,
      active: state?.blockquote,
      run: () => editor?.chain().focus().toggleBlockquote().run(),
    },
    {
      label: "Código",
      icon: Code,
      active: state?.code,
      run: () => editor?.chain().focus().toggleCode().run(),
    },
  ];
  function applyLink() {
    const href = url.trim();
    if (!/^(https?:\/\/|mailto:)/i.test(href)) {
      setLinkError(
        "Escribe un enlace que comience por https://, http:// o mailto:.",
      );
      return;
    }
    editor?.chain().focus().extendMarkRange("link").setLink({ href }).run();
    setLinkOpen(false);
  }
  return (
    <section
      ref={root}
      className="description-editor"
      data-editing={editing}
      aria-label={label}
      onBlurCapture={(event) => {
        if (
          event.relatedTarget instanceof Node &&
          !(
            event.relatedTarget instanceof Element &&
            event.relatedTarget.closest(
              "[data-image-preview], [data-document-picker]",
            )
          ) &&
          !event.currentTarget.contains(event.relatedTarget)
        )
          setEditing(false);
      }}
    >
      {uploading > 0 && (
        <span className="field-hint" role="status">
          Cargando {uploading} imagen(es)…
        </span>
      )}
      {diagramScope && (
        <DocumentDiagramPicker
          scope={diagramScope}
          open={diagramPicker}
          onClose={() => setDiagramPicker(false)}
          onSelect={(diagram) => {
            setDiagramPicker(false);
            startEditing(() =>
              editor
                ?.chain()
                .focus()
                .insertContentAt(
                  diagramInsertion.current ?? editor.state.selection.to,
                  [
                    {
                      type: "diagramReference",
                      attrs: {
                        projectId: diagram.scope.projectId,
                        diagramId: diagram.id,
                        title: diagram.title,
                      },
                    },
                    { type: "paragraph" },
                  ],
                )
                .run(),
            );
          }}
        />
      )}
      <div
        className="description-toolbar"
        role="group"
        aria-label="Formato de la descripción"
      >
        <select
          aria-label="Estilo del texto"
          value={state?.style ?? "p"}
          disabled={!editor || disabled}
          onChange={(event) => {
            const style = event.target.value;
            startEditing(() => {
              if (style === "p") editor?.chain().focus().setParagraph().run();
              else
                editor
                  ?.chain()
                  .focus()
                  .toggleHeading({ level: style === "h2" ? 2 : 3 })
                  .run();
            });
          }}
        >
          <option value="p">Texto</option>
          <option value="h2">Título</option>
          <option value="h3">Subtítulo</option>
        </select>
        {controls.map((control) => (
          <button
            key={control.label}
            type="button"
            aria-label={control.label}
            title={control.label}
            aria-pressed={control.active}
            disabled={!editor || disabled}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => startEditing(control.run)}
          >
            <control.icon size={16} />
          </button>
        ))}
        <button
          type="button"
          aria-label="Añadir o editar enlace"
          title="Añadir o editar enlace"
          aria-pressed={state?.link}
          disabled={!editor || disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            startEditing(() => {
              setUrl(editor?.getAttributes("link").href ?? "");
              setLinkError("");
              setLinkOpen((open) => !open);
            });
          }}
        >
          <Link2 size={16} />
        </button>
        {state?.link && (
          <button
            type="button"
            aria-label="Quitar enlace"
            title="Quitar enlace"
            disabled={disabled}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() =>
              startEditing(() => {
                editor?.chain().focus().unsetLink().run();
              })
            }
          >
            <Unlink size={16} />
          </button>
        )}
        {diagramScope && (
          <button
            type="button"
            aria-label="Insertar diagrama"
            title="Insertar diagrama"
            disabled={!editor || disabled}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() =>
              startEditing(() => {
                diagramInsertion.current = editor?.state.selection.to ?? null;
                setDiagramPicker(true);
              })
            }
          >
            <GitBranch size={16} />
          </button>
        )}
        <button
          type="button"
          aria-label="Deshacer"
          title="Deshacer"
          disabled={disabled || !state?.canUndo}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() =>
            startEditing(() => {
              editor?.chain().focus().undo().run();
            })
          }
        >
          <Undo2 size={16} />
        </button>
        <button
          type="button"
          aria-label="Rehacer"
          title="Rehacer"
          disabled={disabled || !state?.canRedo}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() =>
            startEditing(() => {
              editor?.chain().focus().redo().run();
            })
          }
        >
          <Redo2 size={16} />
        </button>
        <button
          type="button"
          className="description-finish"
          aria-label="Terminar edición de descripción"
          title="Terminar edición"
          disabled={!editing || disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setEditing(false)}
        >
          <Check size={16} />
        </button>
      </div>
      {editing && state?.image && editor && (
        <ImageAlignmentControls
          editor={editor}
          selectedPosition={state.imagePosition}
          alignment={imageAlignment(state.imageAlignment)}
          disabled={disabled}
        />
      )}
      {linkOpen && (
        <div className="description-link-form">
          <Input
            aria-label="Dirección del enlace"
            placeholder="https://ejemplo.com"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            autoFocus
            maxLength={2000}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                applyLink();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setLinkOpen(false);
                editor?.commands.focus();
              }
            }}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled || !url.trim()}
            onClick={applyLink}
          >
            Aplicar
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Cancelar enlace"
            onClick={() => {
              setLinkOpen(false);
              editor?.commands.focus();
            }}
          >
            <X size={14} />
          </Button>
          {linkError && <p role="alert">{linkError}</p>}
        </div>
      )}
      {editing ? (
        <EditorContent
          editor={editor}
          className="description-editor-content"
          onScroll={(event) => {
            scrollTop.current = event.currentTarget.scrollTop;
          }}
        />
      ) : (
        <>
          <div
            className="description-rendered"
            role="region"
            aria-label={
              diagramScope
                ? "Editar contenido del documento"
                : "Editar descripción"
            }
            tabIndex={disabled ? -1 : 0}
            onScroll={(event) => {
              scrollTop.current = event.currentTarget.scrollTop;
            }}
            onKeyDown={(event) => {
              if (
                !disabled &&
                event.target === event.currentTarget &&
                (event.key === "Enter" || event.key === "F2")
              ) {
                event.preventDefault();
                startEditing();
              }
            }}
            onClick={(event) => {
              if (
                !disabled &&
                !(event.target as HTMLElement).closest("a, button")
              ) {
                clickPosition.current = {
                  left: event.clientX,
                  top: event.clientY,
                };
                startEditing();
              }
            }}
          >
            {value ? (
              <MarkdownContent diagramScope={diagramScope}>
                {value}
              </MarkdownContent>
            ) : (
              <span className="description-placeholder">
                Añade contexto, notas o enlaces…
              </span>
            )}
          </div>
        </>
      )}
    </section>
  );
}
