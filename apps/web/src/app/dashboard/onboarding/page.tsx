import { redirect } from "next/navigation";
import { prisma } from "@kesher/db";
import { Card, LinkButton, PageHeader } from "@/components/ui";
import { withBase } from "@/lib/basePath";
import { googleConfigured } from "@/lib/google";
import { he } from "@/lib/he";
import { getSession } from "@/lib/session";
import { finishOnboardingAction } from "./actions";

export const dynamic = "force-dynamic";

function Step({
  n,
  title,
  desc,
  done,
  children,
}: {
  n: number;
  title: string;
  desc: string;
  done: boolean;
  children?: React.ReactNode;
}) {
  return (
    <Card>
      <div className="flex items-start gap-4">
        <span
          className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-bold ${
            done ? "bg-emerald-500 text-white" : "bg-brand/10 text-brand-dark"
          }`}
        >
          {done ? "✓" : n}
        </span>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-ink">{title}</h3>
            {done && <span className="badge-green">{he.obConnected}</span>}
          </div>
          <p className="mt-0.5 text-sm text-slate-500">{desc}</p>
          {children && <div className="mt-3">{children}</div>}
        </div>
      </div>
    </Card>
  );
}

export default async function OnboardingPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const [connected, availability, googleInteg] = await Promise.all([
    prisma.whatsAppConnection.count({ where: { organizationId: session.org, status: "CONNECTED" } }),
    prisma.availabilityRule.count({ where: { organizationId: session.org } }),
    prisma.calendarIntegration.findFirst({ where: { organizationId: session.org, provider: "google" } }),
  ]);

  return (
    <>
      <PageHeader title={he.onboardingTitle} subtitle={he.onboardingIntro} />

      {/* How it works strip */}
      <Card className="mb-6">
        <div className="mb-3 text-sm font-semibold text-ink">{he.obHowItWorks}</div>
        <ol className="grid gap-3 text-sm sm:grid-cols-4">
          {[he.obFlow1, he.obFlow2, he.obFlow3, he.obFlow4].map((t, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand/10 text-xs font-bold text-brand-dark">{i + 1}</span>
              <span className="text-slate-600">{t}</span>
            </li>
          ))}
        </ol>
      </Card>

      <div className="space-y-4">
        <Step n={1} title={he.ob1Title} desc={he.ob1Desc} done={connected > 0}>
          {connected === 0 && <LinkButton href="/dashboard/connections">{he.ob1Cta}</LinkButton>}
        </Step>
        <Step n={2} title={he.ob2Title} desc={he.ob2Desc} done={availability > 0} />
        <Step n={3} title={he.ob3Title} desc={he.ob3Desc} done={Boolean(googleInteg)}>
          {!googleInteg && googleConfigured() && (
            <a href={withBase("/api/integrations/google/start")} className="btn-secondary btn-sm">
              {he.ob3Cta}
            </a>
          )}
        </Step>
      </div>

      <form action={finishOnboardingAction} className="mt-6">
        <button className="btn-primary w-full py-3">{he.obFinish}</button>
      </form>
    </>
  );
}
