import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownContent } from "../src/components/markdown-content";
import { ImagePreviewProvider } from "../src/components/image-preview";

test("la descripción renderiza formato, listas y saltos de línea sin ejecutar HTML o enlaces peligrosos", () => {
  const render = (value: string) =>
    renderToStaticMarkup(
      createElement(ImagePreviewProvider, {
        children: createElement(MarkdownContent, { children: value }),
      }),
    );
  const formatted = render(
    "## Objetivo\n\n**Texto importante** y *énfasis*\nOtra línea\n\n- Paso uno\n- Paso dos\n\n[Referencia](https://example.com)",
  );
  assert.match(formatted, /<h2>Objetivo<\/h2>/);
  assert.match(formatted, /<strong>Texto importante<\/strong>/);
  assert.match(formatted, /<em>énfasis<\/em><br\/>/);
  assert.match(formatted, /<ul>/);
  assert.match(formatted, /href="https:\/\/example.com"/);
  assert.match(formatted, /rel="noopener noreferrer"/);
  const unsafe = render(
    '<script>alert(1)</script>\n\n[Enlace](javascript:alert)\n\n<img src="x" onerror="alert(1)">',
  );
  assert.doesNotMatch(unsafe, /<script|<img|onerror|href="javascript:/);
});

test("las tarjetas muestran la descripción sin enlaces interactivos ni símbolos de formato", () => {
  const html = renderToStaticMarkup(
    createElement(ImagePreviewProvider, {
      children: createElement(MarkdownContent, {
        children: "**Importante** y [referencia](https://example.com)",
        compact: true,
      }),
    }),
  );
  assert.match(html, /Importante/);
  assert.match(html, /referencia/);
  assert.doesNotMatch(html, /<a\b|\*\*|\]\(/);
});
