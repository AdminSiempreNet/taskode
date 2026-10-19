import Image from "@tiptap/extension-image";
import {
  imageAlignment,
  imageDimension,
  parseImageTitle,
  serializeImageTitle,
} from "@/lib/image-formatting";

export const DescriptionImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      alignment: {
        default: "left",
        parseHTML: (element) =>
          imageAlignment(element.getAttribute("data-align")),
        renderHTML: (attributes) => ({
          "data-align": imageAlignment(attributes.alignment),
        }),
      },
    };
  },
  parseMarkdown: (token, helpers) =>
    helpers.createNode("image", {
      src: token.href,
      alt: token.text,
      ...parseImageTitle(token.title),
    }),
  renderMarkdown: (node) => {
    const attrs = node.attrs ?? {};
    const alt = String(attrs.alt ?? "")
      .replace(/\\/g, "\\\\")
      .replace(/[\[\]]/g, "\\$&")
      .replace(/\r?\n/g, " ");
    const src = String(attrs.src ?? "").replace(/[\s()<>]/g, (character) =>
      encodeURIComponent(character),
    );
    const title = serializeImageTitle(attrs)
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"');
    return `![${alt}](${src}${title ? ` "${title}"` : ""})`;
  },
  addNodeView() {
    const createNodeView = this.parent?.();
    if (!createNodeView) return null;
    return (props) => {
      const view = createNodeView(props);
      const image = (view.dom as HTMLElement).querySelector("img");
      const update = view.update?.bind(view);
      // The built-in resize view handles dragging; also sync changes made by
      // the toolbar, undo and redo into its DOM element.
      view.update = (node, decorations, innerDecorations) => {
        if (update && !update(node, decorations, innerDecorations))
          return false;
        if (image) {
          const width = imageDimension(node.attrs.width);
          image.style.width = width ? `${width}px` : "";
          image.style.height = "auto";
        }
        return true;
      };
      return view;
    };
  },
}).configure({
  allowBase64: false,
  resize: {
    enabled: true,
    directions: ["top-left", "top-right", "bottom-left", "bottom-right"],
    minWidth: 80,
    minHeight: 40,
    alwaysPreserveAspectRatio: true,
  },
});
