import { redirect } from "next/navigation";
import { AuthScreen } from "@/components/auth-screen";
import { getActor } from "@/server/access";
import { providersConfigured } from "@/server/auth";
import { repository } from "@/server";
import { oauthRequestView, type PageSearchParams } from "@/server/oauth-ui";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const single = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<PageSearchParams>;
}) {
  const query = await searchParams;
  const requested = single(query.returnTo);
  const returnTo = requested && /^(?:\/notifications(?:\?open=[a-f0-9-]{36})?|\/users(?:\?user=[a-zA-Z0-9_-]{1,200})?)$/.test(requested) ? requested : "/dashboard";
  // An MCP client sent the user here from /oauth2/authorize with a signed query.
  const oauth = await oauthRequestView(query);
  if (oauth?.status === "invalid") redirect("/login?error=oauth_expired");
  if (!oauth && (await getActor())) redirect(returnTo);
  const state = await repository().store.state();
  const error = single(query.error);
  return (
    <AuthScreen
      providers={providersConfigured()}
      bootstrap={!oauth && !state.adminId}
      returnTo={returnTo}
      oauth={oauth?.client}
      error={
        oauth && !state.adminId
          ? "Primero configura la cuenta administradora de Taskode y después conecta la aplicación."
          : error === "oauth_expired"
            ? "La solicitud de conexión caducó o no es válida. Vuelve a conectar la aplicación desde ella."
            : error === "oauth"
              ? "No se pudo autorizar la aplicación. Solo las cuentas que ya tienen acceso a Taskode pueden conectar aplicaciones."
              : error
                ? "No se pudo autorizar el acceso. Comprueba tu cuenta y que tienes una invitación válida."
                : undefined
      }
    />
  );
}
