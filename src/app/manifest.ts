import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Taskode · Proyectos y tareas",
    short_name: "Taskode",
    description: "Tus proyectos, tareas y recordatorios.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    lang: "es",
    background_color: "#10251f",
    theme_color: "#10251f",
    icons: [
      { src: "/pwa-icon/192", sizes: "192x192", type: "image/png" },
      {
        src: "/pwa-icon/512",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/pwa-icon/512",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
