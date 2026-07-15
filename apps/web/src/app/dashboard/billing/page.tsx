import Link from "next/link";
import { redirect } from "next/navigation";
import { PLANS, type PlanId } from "@kesher/billing";
import { prisma } from "@kesher/db";
import { growConfigForOrg } from "@/lib/billing";
import { he } from "@/lib/he";
import { getSession } from "@/lib/session";
import { checkoutAction } from "./actions";

export const dynamic = "force-dynamic";

const ORDER: PlanId[] = ["FREE", "STARTER", "PRO"];

export default async function BillingPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const org = await prisma.organization.findUnique({ where: { id: session.org } });
  if (!org) redirect("/login");
  const current = org.plan as PlanId;
  const growReady = Boolean(await growConfigForOrg(session.org));

  return (
    <div className="mx-auto max-w-4xl p-8">
      <Link href="/dashboard" className="text-sm text-brand">
        {he.backToDashboard}
      </Link>
      <h1 className="mt-2 text-2xl font-bold text-brand-dark">{he.billingTitle}</h1>
      <p className="mb-6 text-sm text-gray-500">
        {he.currentPlan}: <span className="font-medium text-brand">{PLANS[current].name}</span>
      </p>

      {!growReady && (
        <p className="mb-6 rounded-xl bg-amber-50 p-4 text-sm text-amber-800">
          {he.growNotConfigured}{" "}
          <Link href="/dashboard/onboarding" className="font-medium underline">
            {he.goToOnboarding}
          </Link>
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        {ORDER.map((id) => {
          const plan = PLANS[id];
          const isCurrent = id === current;
          return (
            <div
              key={id}
              className={`rounded-2xl bg-white p-6 shadow-sm ${isCurrent ? "ring-2 ring-brand" : ""}`}
            >
              <div className="text-lg font-bold text-brand-dark">{plan.name}</div>
              <div className="mt-1 text-2xl font-bold">
                {plan.priceIls === 0 ? he.free : `₪${plan.priceIls}`}
                {plan.priceIls > 0 && <span className="text-sm font-normal text-gray-400"> / {he.perMonth}</span>}
              </div>
              <ul className="mt-4 space-y-1 text-sm text-gray-600">
                {plan.features.map((f) => (
                  <li key={f}>· {f}</li>
                ))}
              </ul>
              <div className="mt-5">
                {isCurrent ? (
                  <span className="inline-block rounded-lg bg-gray-100 px-4 py-2 text-sm text-gray-500">
                    {he.currentPlan}
                  </span>
                ) : (
                  <form action={checkoutAction}>
                    <input type="hidden" name="plan" value={id} />
                    <button className="w-full rounded-lg bg-brand py-2 text-sm font-semibold text-white hover:bg-brand-dark">
                      {id === "FREE" ? he.choosePlan : he.upgrade}
                    </button>
                  </form>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
