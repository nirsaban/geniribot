import { redirect } from "next/navigation";
import { formatIls, MAX_PAYMENTS, type PlanId } from "@kesher/billing";
import { prisma } from "@kesher/db";
import { PageHeader } from "@/components/ui";
import { growPaymentUrl } from "@/lib/billing";
import { he } from "@/lib/he";
import { effectivePlanForOrg, getPlanCatalog } from "@/lib/plan";
import { getSession } from "@/lib/session";
import { checkoutAction } from "./actions";

export const dynamic = "force-dynamic";

const ORDER: PlanId[] = ["FREE", "STARTER", "PRO"];

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{
    paid?: string;
    pending?: string;
    welcome?: string;
    claimed?: string;
    limit?: string;
  }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { paid, pending, welcome, claimed, limit } = await searchParams;

  const org = await prisma.organization.findUnique({ where: { id: session.org } });
  if (!org) redirect("/login");
  const [current, catalog, payUrl] = await Promise.all([
    effectivePlanForOrg(session.org),
    getPlanCatalog(),
    growPaymentUrl(),
  ]);
  const subscription = await prisma.subscription.findUnique({
    where: { organizationId: session.org },
    select: { currentPeriodEnd: true, paymentsCount: true },
  });
  const firstTime = !org.onboardedAt;

  // A first-time tenant who just paid continues straight to setup.
  if (paid && firstTime) redirect("/dashboard/onboarding");

  const until =
    subscription?.currentPeriodEnd &&
    new Intl.DateTimeFormat("he-IL", { dateStyle: "long" }).format(subscription.currentPeriodEnd);

  return (
    <>
      <PageHeader
        title={welcome || firstTime ? he.choosePlanTitle : he.billingTitle}
        subtitle={
          welcome || firstTime ? he.choosePlanSubtitle : `${he.currentPlan}: ${catalog[current].name}`
        }
      />

      {/* Bounced here by a plan limit (e.g. "create connection" on a full plan) — say why. */}
      {limit === "connections" && (
        <div className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{he.limitConnections}</div>
      )}
      {paid && <div className="mb-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{he.paidBanner}</div>}
      {pending && <div className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{he.pendingBanner}</div>}
      {claimed && <div className="mb-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{he.thankYouClaimedBody}</div>}

      {/* What an active הוראת קבע bought — months are granted up front. */}
      {current !== "FREE" && until && (
        <div className="mb-4 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
          {he.activeUntil(until, subscription?.paymentsCount ?? 1)}
        </div>
      )}

      <div className="grid gap-5 sm:grid-cols-3">
        {ORDER.map((id) => {
          const plan = catalog[id];
          const isCurrent = id === current;
          const featured = id === "STARTER";
          return (
            <div
              key={id}
              className={`card relative flex flex-col p-6 ${featured ? "ring-2 ring-brand" : ""}`}
            >
              {featured && (
                <span className="absolute -top-3 right-6 badge-brand !bg-brand !text-white">הכי פופולרי</span>
              )}
              <div className="text-lg font-bold text-ink">{plan.name}</div>
              <div className="mt-1 flex items-baseline gap-1">
                <span className="text-3xl font-extrabold text-ink">
                  {plan.priceIls === 0 ? he.free : `₪${formatIls(plan.priceIls)}`}
                </span>
                {plan.priceIls > 0 && <span className="text-sm text-slate-400">/ {he.perMonth}</span>}
              </div>
              <ul className="mt-5 flex-1 space-y-2 text-sm text-slate-600">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-center gap-2">
                    <span className="text-brand">✓</span> {f}
                  </li>
                ))}
              </ul>
              <div className="mt-6">
                {isCurrent ? (
                  <span className="btn-secondary w-full cursor-default opacity-70">{he.currentPlan}</span>
                ) : id === "FREE" ? (
                  <form action={checkoutAction}>
                    <input type="hidden" name="plan" value={id} />
                    <button className="w-full btn-secondary">{he.choosePlan}</button>
                  </form>
                ) : (
                  // One shared Grow page for both plans — the payer picks the
                  // product and how many monthly payments there. Grow forbids
                  // being framed (frame-ancestors), so it opens in a new tab.
                  <a
                    href={payUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`block w-full text-center ${featured ? "btn-primary" : "btn-secondary"}`}
                  >
                    {he.upgrade}
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-5 text-center text-xs text-slate-500">{he.directDebitNote(MAX_PAYMENTS)}</p>
    </>
  );
}
