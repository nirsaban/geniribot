"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { PLANS, planPrice, type BillingInterval, type PlanId } from "@kesher/billing";
import { prisma } from "@kesher/db";
import { withBase } from "@/lib/basePath";
import { growPlatformProvider } from "@/lib/billing";
import { getSession } from "@/lib/session";

/**
 * Start a plan change. FREE applies immediately; paid plans go through Grow's
 * recurring payment page — each renewal fires our webhook. If the platform
 * hasn't configured Grow yet, we send the tenant to onboarding.
 */
export async function checkoutAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/login");
  const plan = String(formData.get("plan") ?? "") as PlanId;
  if (!(plan in PLANS)) redirect("/dashboard/billing");
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
    // Platform payments not set up yet — the super admin unlocks plans manually.
    // A brand-new tenant shouldn't be blocked from setup while that happens.
    redirect(firstTime ? "/dashboard/onboarding" : "/dashboard/billing?pending=1");
  }

  const base = process.env.PUBLIC_BASE_URL ?? "https://wabot.miltech.cloud";
  const cycle = interval === "ANNUAL" ? "שנתי" : "חודשי";
  const { url } = await provider.createCheckout({
    plan,
    interval,
    sumIls: planPrice(plan, interval),
    description: `GeniriBot — מסלול ${PLANS[plan].name} (${cycle})`,
    organizationId: session.org,
    notifyUrl: `${base}${withBase("/api/billing/grow/webhook")}`,
    successUrl: `${base}${withBase("/dashboard/billing?paid=1")}`,
    cancelUrl: `${base}${withBase("/dashboard/billing?cancelled=1")}`,
  });
  redirect(url);
}
