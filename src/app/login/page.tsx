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
  searchParams: Promise<{ error?: string; returnTo?: string }>;
}) {
  const query = await searchParams;
  const returnTo = query.returnTo && /^(?:\/notifications(?:\?open=[a-f0-9-]{36})?|\/users(?:\?user=[a-zA-Z0-9_-]{1,200})?)$/.test(query.returnTo) ? query.returnTo : "/dashboard";
  if (await getActor()) redirect(returnTo);
  const state = await repository().store.state();
  return (
    <AuthScreen
      providers={providersConfigured()}
      bootstrap={!state.adminId}
      returnTo={returnTo}
      error={
        query.error
          ? "No se pudo autorizar el acceso. Comprueba tu cuenta y que tienes una invitación válida."
          : undefined
      }
    />
  );
}
