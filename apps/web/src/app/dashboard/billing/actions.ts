"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type PlanId } from "@kesher/billing";
import { prisma } from "@kesher/db";
import { getPlanCatalog } from "@/lib/plan";
import { getSession } from "@/lib/session";
import { claimUnclaimedPayment } from "@/lib/subscriptions";

/**
 * Switch to the FREE plan — applies immediately, no payment involved. Paid
 * plans go through the client-side checkout iframe (see CheckoutButton +
 * /api/billing/checkout) instead of a server action, since embedding Grow's
 * payment page requires browser-side postMessage handling.
 */
export async function checkoutAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/login");
  const catalog = await getPlanCatalog();
  const plan = String(formData.get("plan") ?? "") as PlanId;
  if (plan !== "FREE" || !(plan in catalog)) redirect("/dashboard/billing");

  const org = await prisma.organization.findUnique({ where: { id: session.org } });
  const firstTime = !org?.onboardedAt;

  await prisma.organization.update({ where: { id: session.org }, data: { plan: "FREE" } });
  await prisma.subscription
    .updateMany({ where: { organizationId: session.org }, data: { cancelAtPeriodEnd: true } })
    .catch(() => {});
  revalidatePath("/dashboard/billing");
  // First-time tenants continue to setup right after choosing a plan.
  redirect(firstTime ? "/dashboard/onboarding" : "/dashboard/billing");
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
