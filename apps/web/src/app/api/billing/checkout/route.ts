import { NextResponse } from "next/server";
import type { BillingInterval, PlanId } from "@kesher/billing";
import { growPaymentUrlFor, withOrgField, type PaidPlanId } from "@/lib/billing";
import { getPlanCatalog } from "@/lib/plan";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Tenant starts a paid-plan checkout — returns the static Grow-hosted
 * payment page URL for the client to embed in an iframe (kept on-site),
 * tagged with the org id so the notifyUrl webhook can activate the right
 * tenant once paid.
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { plan, interval: rawInterval } = (await req.json()) as { plan?: PlanId; interval?: string };
  const catalog = await getPlanCatalog();
  if (!plan || !(plan in catalog) || plan === "FREE") {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const interval: BillingInterval = rawInterval === "ANNUAL" ? "ANNUAL" : "MONTHLY";

  const url = await growPaymentUrlFor(plan as PaidPlanId, interval);
  if (!url) return NextResponse.json({ error: "not_configured" }, { status: 400 });

  return NextResponse.json({ url: withOrgField(url, session.org) });
}
