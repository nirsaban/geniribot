import { redirect } from "next/navigation";
import { prisma } from "@kesher/db";
import { PageHeader } from "@/components/ui";
import { googleConfigured } from "@/lib/google";
import { he } from "@/lib/he";
import { metaPublicConfig } from "@/lib/meta";
import { getSession } from "@/lib/session";
import { finishOnboardingAction } from "./actions";
import { OnboardingWizard } from "./OnboardingWizard";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const [connected, org, googleInteg, meta] = await Promise.all([
    prisma.whatsAppConnection.count({ where: { organizationId: session.org, status: "CONNECTED" } }),
    prisma.organization.findUnique({ where: { id: session.org }, select: { calcomLink: true } }),
    prisma.calendarIntegration.findFirst({ where: { organizationId: session.org, provider: "google" } }),
    metaPublicConfig(),
  ]);

  return (
    <>
      <PageHeader title={he.onboarding} subtitle={he.onboardingIntro} />
      <OnboardingWizard
        connected={connected > 0}
        googleConnected={Boolean(googleInteg)}
        googleConfigured={googleConfigured()}
        calcomLink={org?.calcomLink ?? null}
        meta={meta}
        finish={finishOnboardingAction}
      />
    </>
  );
}
