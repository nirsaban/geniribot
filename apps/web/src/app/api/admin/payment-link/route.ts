import { NextResponse } from "next/server";
import type { PlanId } from "@kesher/billing";
import { growPaymentUrlFor, withOrgField, type PaidPlanId } from "@/lib/billing";
import { getPlanCatalog } from "@/lib/plan";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Super admin generates a Grow payment link for an org + plan (static per-plan links). */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.sa) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { orgId, plan, interval: rawInterval } = (await req.json()) as {
    orgId?: string;
    plan?: PlanId;
    interval?: string;
  };
  const catalog = await getPlanCatalog();
  if (!orgId || !plan || !(plan in catalog) || plan === "FREE") {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const interval = rawInterval === "ANNUAL" ? "ANNUAL" : "MONTHLY";

  const url = await growPaymentUrlFor(plan as PaidPlanId, interval);
  if (!url) return NextResponse.json({ error: "not_configured" }, { status: 400 });

  return NextResponse.json({ url: withOrgField(url, orgId) });
}
