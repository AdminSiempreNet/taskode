import { GitBranch } from "lucide-react";
export default function UnavailableDiagram() {
  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "grid",
        placeContent: "center",
        textAlign: "center",
        gap: 15,
        padding: 24,
      }}
    >
      <GitBranch
        size={36}
        style={{ margin: "auto", color: "var(--primary)" }}
      />
      <h1 style={{ fontSize: 22, fontWeight: 600 }}>Diagrama no disponible</h1>
      <p style={{ color: "var(--muted-foreground)", fontSize: 14 }}>
        El enlace no existe o ha dejado de ser público.
      </p>
    </main>
  );
}
