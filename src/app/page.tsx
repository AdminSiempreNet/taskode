import { redirect } from "next/navigation";
import { LandingPage } from "@/components/landing-page";
import { getActor } from "@/server/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ project?: string | string[] }>;
}) {
  const { project } = await searchParams;
  if (typeof project === "string" && project)
    redirect(`/projects?project=${encodeURIComponent(project)}`);
  if (await getActor()) redirect("/dashboard");
  return <LandingPage />;
}
