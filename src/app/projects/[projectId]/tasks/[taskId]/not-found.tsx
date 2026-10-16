import Link from "next/link";
import { FileQuestion } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

export default function TaskNotFound() {
  return (
    <main className="empty-state">
      <span className="empty-icon">
        <FileQuestion />
      </span>
      <h1>Tarea no encontrada</h1>
      <p>Esta tarea no existe en este proyecto o fue eliminada.</p>
      <Link href="/" className={buttonVariants()}>
        Volver a mis proyectos
      </Link>
    </main>
  );
}
