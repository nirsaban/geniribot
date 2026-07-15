import { redirect } from "next/navigation";
import { PLANS, type PlanId } from "@kesher/billing";
import { prisma } from "@kesher/db";
import { PageHeader } from "@/components/ui";
import { he } from "@/lib/he";
import { getSession } from "@/lib/session";
import { checkoutAction } from "./actions";

export const dynamic = "force-dynamic";

const ORDER: PlanId[] = ["FREE", "STARTER", "PRO"];

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ paid?: string; pending?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { paid, pending } = await searchParams;

  const org = await prisma.organization.findUnique({ where: { id: session.org } });
  if (!org) redirect("/login");
  const current = org.plan as PlanId;

  return (
    <>
      <PageHeader
        title={he.billingTitle}
        subtitle={`${he.currentPlan}: ${PLANS[current].name}`}
      />

      {paid && <div className="mb-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">התשלום התקבל, המסלול עודכן ✅</div>}
      {pending && <div className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">בקשת השדרוג התקבלה. נציג יאשר את המנוי בקרוב 🙌</div>}

      <div className="grid gap-5 sm:grid-cols-3">
        {ORDER.map((id) => {
          const plan = PLANS[id];
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
                  {plan.priceIls === 0 ? he.free : `₪${plan.priceIls}`}
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
                ) : (
                  <form action={checkoutAction}>
                    <input type="hidden" name="plan" value={id} />
                    <button className={`w-full ${featured ? "btn-primary" : "btn-secondary"}`}>
                      {id === "FREE" ? he.choosePlan : he.upgrade}
                    </button>
                  </form>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
