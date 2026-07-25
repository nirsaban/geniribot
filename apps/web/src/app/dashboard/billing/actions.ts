"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { planPrice, type BillingInterval, type PlanId } from "@kesher/billing";
import { prisma } from "@kesher/db";
import { withBase } from "@/lib/basePath";
import { growPaymentUrl, growPlatformProvider } from "@/lib/billing";
import { getPlanCatalog } from "@/lib/plan";
import { getSession } from "@/lib/session";
import { claimUnclaimedPayment } from "@/lib/subscriptions";

/**
 * Start a plan change. FREE applies immediately; paid plans go through Grow's
 * recurring payment page — each renewal fires our webhook. Until per-org API
 * checkout is configured, paid plans fall back to the static Grow payment
 * page set in /admin.
 */
export async function checkoutAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/login");
  const catalog = await getPlanCatalog();
  const plan = String(formData.get("plan") ?? "") as PlanId;
  if (!(plan in catalog)) redirect("/dashboard/billing");
  const interval: BillingInterval =
    String(formData.get("interval") ?? "MONTHLY") === "ANNUAL" ? "ANNUAL" : "MONTHLY";

  const org = await prisma.organization.findUnique({ where: { id: session.org } });
  const firstTime = !org?.onboardedAt;

  if (plan === "FREE") {
    await prisma.organization.update({ where: { id: session.org }, data: { plan: "FREE" } });
    await prisma.subscription
      .updateMany({ where: { organizationId: session.org }, data: { cancelAtPeriodEnd: true } })
      .catch(() => {});
    revalidatePath("/dashboard/billing");
    // First-time tenants continue to setup right after choosing a plan.
    redirect(firstTime ? "/dashboard/onboarding" : "/dashboard/billing");
  }

  const provider = await growPlatformProvider();
  if (!provider) {
    // API-driven checkout isn't configured yet — send them to the static
    // Grow payment page instead (super-admin sets it in /admin) rather than
    // stalling a brand-new tenant's setup. We already know the org here, so
    // tag the link with our custom fields — IF that page's Grow config
    // echoes them back, the webhook attributes the payment automatically;
    // if not, it's harmlessly ignored and falls back to the unclaimed-payment
    // flow (see subscriptions.ts) once they're back in the app.
    const url = new URL(await growPaymentUrl());
    url.searchParams.set("cField1", session.org);
    url.searchParams.set("cField2", plan);
    url.searchParams.set("cField3", interval);
    redirect(url.toString());
  }

  const base = process.env.PUBLIC_BASE_URL ?? "https://wabot.miltech.cloud";
  const cycle = interval === "ANNUAL" ? "שנתי" : "חודשי";
  const { url } = await provider.createCheckout({
    plan,
    interval,
    sumIls: planPrice(plan, interval, catalog),
    description: `GeniriBot — מסלול ${catalog[plan].name} (${cycle})`,
    organizationId: session.org,
    notifyUrl: `${base}${withBase("/api/billing/grow/webhook")}`,
    successUrl: `${base}${withBase("/dashboard/billing?paid=1")}`,
    cancelUrl: `${base}${withBase("/dashboard/billing?cancelled=1")}`,
  });
  redirect(url);
}

/**
 * Manually attach a Grow payment that has no organizationId on it (paid
 * through a static hosted page, e.g. from the thank-you page when the
 * account's own email didn't match). Best-effort — wrong/no match just
 * redirects back with nothing changed.
 */
export async function claimPaymentAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/login");
  const identifier = String(formData.get("identifier") ?? "").trim();
  const result = identifier ? await claimUnclaimedPayment(session.org, identifier) : { applied: false };
  revalidatePath("/dashboard/billing");
  redirect(result.applied ? "/dashboard/billing?claimed=1" : "/dashboard/billing?claimFailed=1");
}
