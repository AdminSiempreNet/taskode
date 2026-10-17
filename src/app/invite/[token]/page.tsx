import Link from "next/link";
import { AuthScreen } from "@/components/auth-screen";
import { TaskodeBrand } from "@/components/taskode-brand";
import { invitationService, providersConfigured } from "@/server/auth";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export default async function Invite({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  try {
    const invitation = await invitationService().verify(token),
      query = await searchParams;
    return (
      <AuthScreen
        providers={providersConfigured()}
        invitation={token}
        email={invitation.email}
        error={
          query.error
            ? "La cuenta utilizada no pudo aceptar esta invitación. Comprueba que su correo coincide."
            : undefined
        }
      />
    );
  } catch {
    return (
      <main className="auth-shell">
        <section className="auth-card auth-message-card">
          <TaskodeBrand />
          <h1>Invitación no disponible</h1>
          <p>
            El enlace venció, fue revocado o ya se utilizó. Solicita una nueva
            invitación al administrador.
          </p>
          <Link href="/login">Ir al inicio de sesión</Link>
        </section>
      </main>
    );
  }
}
