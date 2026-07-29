import { NextResponse } from "next/server";
import { planPrice, type BillingInterval, type PlanId } from "@kesher/billing";
import { prisma } from "@kesher/db";
import { toIsraeliLocalPhone } from "@/lib/audience";
import { withBase } from "@/lib/basePath";
import { growPaymentUrl, growPlatformProvider } from "@/lib/billing";
import { getPlanCatalog } from "@/lib/plan";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Tenant starts a paid-plan checkout — returns the Grow payment URL for the
 * client to embed in an iframe (kept on-site) instead of a full redirect.
 * Falls back to the static hosted page (tagged with our custom fields) until
 * per-org API checkout is configured, same as the old `checkoutAction`.
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

  const provider = await growPlatformProvider();
  if (!provider) {
    const url = new URL(await growPaymentUrl());
    url.searchParams.set("cField1", session.org);
    url.searchParams.set("cField2", plan);
    url.searchParams.set("cField3", interval);
    return NextResponse.json({ url: url.toString() });
  }

  // Grow requires a full name + Israeli mobile number to create the payment
  // link — pull them from the signed-in user rather than asking again.
  const [user, org] = await Promise.all([
    prisma.user.findUnique({ where: { id: session.sub }, select: { name: true, email: true, notifyPhone: true } }),
    prisma.organization.findUnique({ where: { id: session.org }, select: { name: true } }),
  ]);
  const localPhone = user?.notifyPhone ? toIsraeliLocalPhone(user.notifyPhone) : null;
  if (!localPhone) {
    return NextResponse.json({ error: "missing_phone" }, { status: 400 });
  }

  const base = process.env.PUBLIC_BASE_URL ?? "https://wabot.miltech.cloud";
  const cycle = interval === "ANNUAL" ? "שנתי" : "חודשי";
  try {
    const { url } = await provider.createCheckout({
      plan,
      interval,
      sumIls: planPrice(plan, interval, catalog),
      description: `GeniriBot — מסלול ${catalog[plan].name} (${cycle})`,
      organizationId: session.org,
      notifyUrl: `${base}${withBase("/api/billing/grow/webhook")}`,
      successUrl: `${base}${withBase("/dashboard/billing?paid=1")}`,
      cancelUrl: `${base}${withBase("/dashboard/billing?cancelled=1")}`,
      payerName: user?.name ?? org?.name ?? "לקוח GeniriBot",
      payerPhone: localPhone,
      payerEmail: user?.email,
    });
    return NextResponse.json({ url });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
