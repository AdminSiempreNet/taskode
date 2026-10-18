import { Extension } from "@tiptap/core";
import Youtube from "@tiptap/extension-youtube";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { youtubeUrl } from "@/lib/files";
export const MarkdownYoutube = Youtube.extend({
  markdownTokenizer: {
    name: "youtube",
    level: "block",
    start: (src: string) =>
      src.search(
        /https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be|m\.youtube\.com)/,
      ),
    tokenize: (src: string) => {
      const match = /^(https?:\/\/[^\s]+)[ \t]*(?:\n|$)/.exec(src);
      return match && youtubeUrl(match[1])
        ? { type: "youtube", raw: match[0], src: match[1] }
        : undefined;
    },
  },
  parseMarkdown: (token, helpers) =>
    helpers.createNode("youtube", { src: token.src }),
  renderMarkdown: (node) => `${node.attrs?.src ?? ""}`,
}).configure({ nocookie: true, autoplay: false, addPasteHandler: true });

export function imagePasteExtension(
  upload: (file: File) => Promise<string>,
  pending: (count: number) => void,
  failure: (message: string) => void,
) {
  const key = new PluginKey<DecorationSet>("imageUploads");
  let uploading = 0;
  return Extension.create({
    name: "imageUploads",
    addProseMirrorPlugins() {
      return [
        new Plugin<DecorationSet>({
          key,
          state: {
            init: () => DecorationSet.empty,
            apply: (tr, old) => {
              let set = old.map(tr.mapping, tr.doc);
              const action = tr.getMeta(key);
              if (action?.add) {
                const span = document.createElement("span");
                span.className = "image-upload-placeholder";
                span.textContent = "Cargando imagen…";
                span.setAttribute("role", "status");
                set = set.add(tr.doc, [
                  Decoration.widget(action.pos, span, { id: action.add }),
                ]);
              }
              if (action?.remove)
                set = set.remove(
                  set.find(
                    undefined,
                    undefined,
                    (spec) => spec.id === action.remove,
                  ),
                );
              return set;
            },
          },
          props: {
            decorations: (state) => key.getState(state),
            handlePaste: (view, event) => {
              const files = Array.from(event.clipboardData?.files ?? []).filter(
                (f) => f.type.startsWith("image/"),
              );
              if (!files.length) return false;
              event.preventDefault();
              for (const file of files) {
                const id = {};
                view.dispatch(
                  view.state.tr.setMeta(key, {
                    add: id,
                    pos: view.state.selection.from,
                  }),
                );
                pending(++uploading);
                void upload(file)
                  .then((url) => {
                    if (view.isDestroyed) return;
                    const placeholder = key
                      .getState(view.state)
                      ?.find(undefined, undefined, (spec) => spec.id === id)[0];
                    if (placeholder)
                      view.dispatch(
                        view.state.tr
                          .replaceWith(
                            placeholder.from,
                            placeholder.from,
                            view.state.schema.nodes.image.create({
                              src: url,
                              alt: file.name || "Imagen",
                            }),
                          )
                          .setMeta(key, { remove: id }),
                      );
                  })
                  .catch((error) => {
                    if (!view.isDestroyed)
                      view.dispatch(view.state.tr.setMeta(key, { remove: id }));
                    failure((error as Error).message);
                  })
                  .finally(() => pending(--uploading));
              }
              return true;
            },
          },
        }),
      ];
    },
  });
}
