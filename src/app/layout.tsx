import type { Metadata } from "next";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { ImagePreviewProvider } from "@/components/image-preview";
import "./globals.css";
import "./notifications.css";
export const metadata: Metadata = {
  title: "Taskode · Proyectos y tareas de desarrollo",
  description:
    "Organiza proyectos de software, features y tareas con tu equipo. Del backlog al siguiente deploy.",
};
export const maxDuration = 60;
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body>
        <ThemeProvider>
          <ImagePreviewProvider>{children}</ImagePreviewProvider>
          <Toaster position="bottom-right" richColors closeButton />
        </ThemeProvider>
      </body>
    </html>
  );
}
