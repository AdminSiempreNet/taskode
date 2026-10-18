"use client";
import { useEffect, useRef } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import Image from "@tiptap/extension-image";
import { toast } from "sonner";
import { MarkdownYoutube, imagePasteExtension } from "./media-extensions";
import { uploadFile } from "@/lib/file-client";
export function MessageEditor(props: {
  value: string;
  onChange: (value: string) => void;
  projectId: string;
  taskId: string;
  disabled: boolean;
  onSend?: () => void;
  onUploading?: (count: number) => void;
  onReady?: (editor: Editor | null) => void;
}) {
  const latest = useRef(props);
  latest.current = props;
  const last = useRef(props.value);
  const editor = useEditor({
    immediatelyRender: false,
    content: props.value,
    contentType: "markdown",
    extensions: [
      StarterKit.configure({
        heading: false,
        trailingNode: false,
        link: { openOnClick: false },
      }),
      Markdown.configure({ markedOptions: { breaks: true } }),
      Image.configure({ allowBase64: false }),
      MarkdownYoutube,
      imagePasteExtension(
        async (file) =>
          (
            await uploadFile(
              file,
              latest.current.projectId,
              latest.current.taskId,
              "image",
            )
          ).url,
        (count) => latest.current.onUploading?.(count),
        (message) => toast.error(message),
      ),
    ],
    editorProps: {
      attributes: {
        class: "message-editor rich-text",
        role: "textbox",
        "aria-label": "Escribir comentario",
        "aria-placeholder": "Escribe un mensaje…",
        "aria-multiline": "true",
        "data-placeholder": "Escribe un mensaje…",
      },
      handleKeyDown: (_view, event) => {
        if (
          event.key === "Enter" &&
          !event.shiftKey &&
          !event.isComposing &&
          latest.current.onSend
        ) {
          event.preventDefault();
          latest.current.onSend();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      const value = editor.getMarkdown();
      if (value.length > 10000) {
        editor.commands.setContent(last.current, {
          contentType: "markdown",
          emitUpdate: false,
        });
        toast.error("El comentario admite hasta 10.000 caracteres.");
        return;
      }
      last.current = value;
      latest.current.onChange(value);
    },
  });
  useEffect(() => {
    if (editor && props.value !== last.current) {
      editor.commands.setContent(props.value, {
        contentType: "markdown",
        emitUpdate: false,
      });
      last.current = props.value;
    }
  }, [props.value, editor]);
  useEffect(() => {
    editor?.setEditable(!props.disabled, false);
  }, [editor, props.disabled]);
  useEffect(() => {
    if (!editor) return;
    const updateEmptyState = () => {
      editor.view.dom.setAttribute("data-empty", String(editor.isEmpty));
    };
    updateEmptyState();
    editor.on("transaction", updateEmptyState);
    return () => {
      editor.off("transaction", updateEmptyState);
    };
  }, [editor]);
  useEffect(() => {
    latest.current.onReady?.(editor);
    return () => latest.current.onReady?.(null);
  }, [editor]);
  return <EditorContent editor={editor} />;
}
