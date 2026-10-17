import { redirect } from "next/navigation";
import { LandingPage } from "@/components/landing-page";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ project?: string | string[] }>;
}) {
  const { project } = await searchParams;
  if (typeof project === "string" && project)
    redirect(`/projects?project=${encodeURIComponent(project)}`);
  return <LandingPage />;
}
