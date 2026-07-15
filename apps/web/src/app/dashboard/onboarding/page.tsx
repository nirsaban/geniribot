import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@kesher/db";
import { GROW_SECRETS } from "@/lib/billing";
import { he } from "@/lib/he";
import { secretMask } from "@/lib/secrets";
import { getSession } from "@/lib/session";
import { GrowSecrets } from "../settings/GrowSecrets";
import { finishOnboardingAction } from "./actions";

export const dynamic = "force-dynamic";

function StepHeader({ title, done }: { title: string; done: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="font-semibold">{title}</h2>
      <span
        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
          done ? "bg-brand/10 text-brand" : "bg-gray-100 text-gray-500"
        }`}
      >
        {done ? he.stepDone : he.stepTodo}
      </span>
    </div>
  );
}

export default async function OnboardingPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const [connected, availability, pageCodeMask, userIdMask, apiKeyMask] = await Promise.all([
    prisma.whatsAppConnection.count({
      where: { organizationId: session.org, status: "CONNECTED" },
    }),
    prisma.availabilityRule.count({ where: { organizationId: session.org } }),
    secretMask(session.org, GROW_SECRETS.pageCode),
    secretMask(session.org, GROW_SECRETS.userId),
    secretMask(session.org, GROW_SECRETS.apiKey),
  ]);
  const growSet = Boolean(pageCodeMask && userIdMask);

  return (
    <div className="mx-auto max-w-2xl p-8">
      <Link href="/dashboard" className="text-sm text-brand">
        {he.backToDashboard}
      </Link>
      <h1 className="mt-2 text-2xl font-bold text-brand-dark">{he.onboardingTitle}</h1>
      <p className="mb-6 text-sm text-gray-500">{he.onboardingIntro}</p>

      <div className="space-y-4">
        {/* Step 1 — WhatsApp */}
        <section className="rounded-2xl bg-white p-6 shadow-sm">
          <StepHeader title={he.ob1Title} done={connected > 0} />
          <p className="mb-3 mt-1 text-sm text-gray-500">{he.ob1Desc}</p>
          {connected > 0 ? (
            <span className="text-sm font-medium text-brand">{he.obConnected}</span>
          ) : (
            <Link
              href="/dashboard/connections"
              className="inline-block rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark"
            >
              {he.ob1Cta}
            </Link>
          )}
        </section>

        {/* Step 2 — Availability */}
        <section className="rounded-2xl bg-white p-6 shadow-sm">
          <StepHeader title={he.ob2Title} done={availability > 0} />
          <p className="mt-1 text-sm text-gray-500">{he.ob2Desc}</p>
        </section>

        {/* Step 3 — Grow secrets (optional, secure paste) */}
        <section className="rounded-2xl bg-white p-6 shadow-sm">
          <StepHeader title={he.ob3Title} done={growSet} />
          <p className="mb-4 mt-1 text-sm text-gray-500">{he.ob3Desc}</p>
          <GrowSecrets pageCodeMask={pageCodeMask} userIdMask={userIdMask} apiKeyMask={apiKeyMask} />
        </section>
      </div>

      <form action={finishOnboardingAction} className="mt-6">
        <button className="w-full rounded-lg bg-brand py-3 font-semibold text-white hover:bg-brand-dark">
          {he.obFinish}
        </button>
      </form>
    </div>
  );
}
