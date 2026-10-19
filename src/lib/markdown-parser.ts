import { Marked, type marked } from "marked";

// Tiptap expects the callable singleton type but uses only the instance API.
// Isolate tokenizers per editor so document embeds never affect descriptions.
export function createMarkdownParser() {
  return new Marked() as unknown as typeof marked;
}
