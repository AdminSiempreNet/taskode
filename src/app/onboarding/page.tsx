import { redirect } from "next/navigation";
import { requirePageActor } from "@/server/access";
import { repository } from "@/server";
import { OnboardingWizard } from "@/components/onboarding-wizard";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export default async function Onboarding() {
  const actor = await requirePageActor(),
    repo = repository();
  const workspace = await repo.getWorkspace(actor);
  if (workspace.currentUser.role !== "admin" || workspace.onboarding.step >= 2)
    redirect("/dashboard");
  return <OnboardingWizard workspace={workspace} />;
}
