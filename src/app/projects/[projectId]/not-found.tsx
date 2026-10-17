import Link from "next/link";
import { FolderSearch } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

export default function ProjectNotFound() {
  return (
    <main className="empty-state">
      <span className="empty-icon">
        <FolderSearch />
      </span>
      <h1>Proyecto no encontrado</h1>
      <p>Este proyecto no existe o fue eliminado.</p>
      <Link href="/projects" className={buttonVariants()}>
        Volver a mis proyectos
      </Link>
    </main>
  );
}
