import { cp, mkdir } from "node:fs/promises";

const destination = new URL("../public/excalidraw/", import.meta.url);
await mkdir(destination, { recursive: true });
await cp(
  new URL(
    "../node_modules/@excalidraw/excalidraw/dist/prod/fonts/",
    import.meta.url,
  ),
  new URL("fonts/", destination),
  { recursive: true },
);
