"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { PLANS, type PlanId } from "@kesher/billing";
import { prisma } from "@kesher/db";
import { withBase } from "@/lib/basePath";
import { growProviderForOrg } from "@/lib/billing";
import { getSession } from "@/lib/session";

/**
 * Start a plan change. FREE applies immediately; paid plans go through Grow —
 * if the tenant hasn't configured Grow yet, we send them to onboarding.
 */
export async function checkoutAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/login");
  const plan = String(formData.get("plan") ?? "") as PlanId;
  if (!(plan in PLANS)) redirect("/dashboard/billing");

  if (plan === "FREE") {
    await prisma.organization.update({ where: { id: session.org }, data: { plan: "FREE" } });
    revalidatePath("/dashboard/billing");
    redirect("/dashboard/billing");
  }

  const provider = await growProviderForOrg(session.org);
  if (!provider) {
    redirect("/dashboard/onboarding?need=grow");
  }

  const base = process.env.PUBLIC_BASE_URL ?? "https://wabot.miltech.cloud";
  const { url } = await provider.createCheckout({
    plan,
    sumIls: PLANS[plan].priceIls,
    description: `Kesher — מסלול ${PLANS[plan].name}`,
    organizationId: session.org,
    successUrl: `${base}${withBase("/dashboard/billing?paid=1")}`,
    cancelUrl: `${base}${withBase("/dashboard/billing?cancelled=1")}`,
  });
  redirect(url);
}
