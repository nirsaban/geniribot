import { NextResponse } from "next/server";
import { PLANS, type PlanId } from "@kesher/billing";
import { withBase } from "@/lib/basePath";
import { growPlatformProvider } from "@/lib/billing";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Super admin generates a Grow payment link for an org + plan (platform creds). */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.sa) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { orgId, plan } = (await req.json()) as { orgId?: string; plan?: PlanId };
  if (!orgId || !plan || !(plan in PLANS)) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const provider = await growPlatformProvider();
  if (!provider) return NextResponse.json({ error: "not_configured" }, { status: 400 });

  const base = process.env.PUBLIC_BASE_URL ?? "https://wabot.miltech.cloud";
  try {
    const { url } = await provider.createCheckout({
      plan,
      sumIls: PLANS[plan].priceIls,
      description: `Kesher — מסלול ${PLANS[plan].name}`,
      organizationId: orgId,
      successUrl: `${base}${withBase("/dashboard/billing?paid=1")}`,
      cancelUrl: `${base}${withBase("/dashboard/billing?cancelled=1")}`,
    });
    return NextResponse.json({ url });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
