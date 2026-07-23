import { redirect } from "next/navigation";
import { LandingPage } from "@/components/landing/LandingPage";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getSession();
  if (session) redirect("/dashboard");
  return <LandingPage />;
}
