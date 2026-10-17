import { redirect } from "next/navigation";
import { AuthScreen } from "@/components/auth-screen";
import { getActor } from "@/server/access";
import { providersConfigured } from "@/server/auth";
import { repository } from "@/server";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await getActor()) redirect("/projects");
  const state = await repository().store.state(),
    query = await searchParams;
  return (
    <AuthScreen
      providers={providersConfigured()}
      bootstrap={!state.adminId}
      error={
        query.error
          ? "No se pudo autorizar el acceso. Comprueba tu cuenta y que tienes una invitación válida."
          : undefined
      }
    />
  );
}
