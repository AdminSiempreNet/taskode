import { test } from "node:test";
import assert from "node:assert/strict";
import { MarkdownManager } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { MarkdownYoutube } from "../src/components/media-extensions";
import { DescriptionImage } from "../src/components/description-image";
import {
  parseImageTitle,
  serializeImageTitle,
} from "../src/lib/image-formatting";
test("descripciones y mensajes conservan imágenes y YouTube al editar y guardar Markdown", () => {
  const manager = new MarkdownManager({
    extensions: [
      StarterKit,
      Image.configure({ allowBase64: false }),
      MarkdownYoutube,
    ],
  });
  const input =
    "Texto **importante**\n\n![Captura](/api/files/00000000-0000-4000-8000-000000000000/content)\n\nhttps://youtu.be/dQw4w9WgXcQ";
  const parsed = manager.parse(input);
  assert.ok(parsed.content?.some((n) => n.type === "image"));
  assert.ok(parsed.content?.some((n) => n.type === "youtube"));
  const saved = manager.serialize(parsed);
  assert.match(saved, /!\[Captura\]\(\/api\/files\//);
  assert.match(saved, /https:\/\/youtu.be\/dQw4w9WgXcQ/);
  assert.doesNotMatch(saved, /<iframe|base64|X-Amz/);
  assert.deepEqual(manager.parse(saved), parsed);
});

test("el tamaño y la alineación de imágenes sobreviven a guardar y volver a editar Markdown", () => {
  const manager = new MarkdownManager({
    extensions: [StarterKit, DescriptionImage, MarkdownYoutube],
  });
  const source =
    '![Referencia](/api/files/00000000-0000-4000-8000-000000000000/content "Una referencia visual")';
  const document = manager.parse(source);
  const image = document.content!.find((node) => node.type === "image")!;
  assert.equal(image.attrs?.alignment, "left");
  for (const alignment of ["left", "center", "right"]) {
    image.attrs = { ...image.attrs, width: 320, height: 200, alignment };
    const saved = manager.serialize(document);
    assert.match(saved, /taskode-image:v1;width=320;height=200/);
    assert.doesNotMatch(saved, /<img|style=/);
    assert.deepEqual(manager.parse(saved), document);
    const title = parseImageTitle(serializeImageTitle(image.attrs));
    assert.equal(title.title, "Una referencia visual");
    assert.equal(title.alignment, alignment);
    assert.equal(title.width, 320);
  }
  image.attrs = {
    ...image.attrs,
    width: null,
    height: null,
    alignment: "left",
  };
  assert.equal(manager.serialize(document).trim(), source);
});

test("los títulos normales y los metadatos inválidos no se convierten en estilos arbitrarios", () => {
  assert.deepEqual(parseImageTitle('Referencia "principal"'), {
    width: null,
    height: null,
    alignment: "left",
    title: 'Referencia "principal"',
  });
  const malformed =
    "taskode-image:v1;width=200;height=100;align=center;title=%ZZ";
  assert.equal(parseImageTitle(malformed).title, malformed);
  assert.equal(
    parseImageTitle("taskode-image:v1;width=999999;height=0;align=right").width,
    null,
  );
  assert.equal(
    parseImageTitle("taskode-image:v1;width=auto;height=auto;align=right")
      .alignment,
    "right",
  );
  assert.equal(
    serializeImageTitle({
      width: "100%;background:red",
      alignment: "javascript:alert(1)",
    }),
    "",
  );
  const title = 'Captura "final" (revisión) · 100%';
  assert.equal(
    parseImageTitle(
      serializeImageTitle({ width: 400, alignment: "center", title }),
    ).title,
    title,
  );
});
