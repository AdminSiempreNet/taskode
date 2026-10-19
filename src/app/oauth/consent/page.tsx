import { redirect } from "next/navigation";
import { OAuthConsent } from "@/components/oauth-consent";
import { getActor } from "@/server/access";
import { repository } from "@/server";
import { oauthRequestView, type PageSearchParams } from "@/server/oauth-ui";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export default async function Consent({
  searchParams,
}: {
  searchParams: Promise<PageSearchParams>;
}) {
  const view = await oauthRequestView(await searchParams);
  if (view?.status !== "valid") redirect("/login?error=oauth_expired");
  const actor = await getActor();
  // Keep the same signed query so the login resumes this authorization.
  if (!actor) redirect(`/login?${view.query}`);
  const user = await repository().currentUser(actor);
  return (
    <OAuthConsent
      client={view.client}
      scopes={view.scopes}
      isAdmin={user.role === "admin"}
      account={user.email}
    />
  );
}
