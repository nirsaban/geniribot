"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type PlanId } from "@kesher/billing";
import { prisma } from "@kesher/db";
import { getPlanCatalog } from "@/lib/plan";
import { getSession } from "@/lib/session";

/**
 * Switch to the FREE plan — applies immediately, no payment involved. Paid
 * plans aren't a server action at all: the billing page links straight out to
 * the one Grow payment page, and the plan is opened when Grow's callback comes
 * back (see `applyGrowPayment`).
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

