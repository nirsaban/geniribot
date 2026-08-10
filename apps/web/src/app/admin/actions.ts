"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { PLANS, type PlanId } from "@kesher/billing";
import { prisma } from "@kesher/db";
import { META_SECRETS } from "@/lib/meta";
import { deleteSecret, setSecret } from "@/lib/secrets";
import { getSession } from "@/lib/session";
import { claimPaymentById, setPlanManually } from "@/lib/subscriptions";

async function requireSuperAdmin(): Promise<{ org: string }> {
  const s = await getSession();
  if (!s?.sa) redirect("/dashboard");
  return { org: s.org };
}

/**
 * Super admin manually sets (unlocks) any org's plan — activates a real
 * subscription, exactly as a paid Grow checkout would, so the tenant is no
 * longer asked to upgrade. See `setPlanManually`.
 */
export async function setOrgPlanAction(formData: FormData): Promise<void> {
  await requireSuperAdmin();
  const orgId = String(formData.get("orgId") ?? "");
  const plan = String(formData.get("plan") ?? "") as PlanId;
  if (!orgId || !(plan in PLANS)) return;
  await setPlanManually(orgId, plan);
  revalidatePath("/admin");
  revalidatePath("/dashboard/billing");
  revalidatePath("/dashboard");
}

/** Save THE Grow payment page URL — one link for the whole platform. */
export async function savePlatformPaymentUrlAction(formData: FormData): Promise<void> {
  const { org } = await requireSuperAdmin();
  await prisma.organization.update({
    where: { id: org },
    data: { growPaymentUrl: String(formData.get("payment_url") ?? "").trim() || null },
  });
  revalidatePath("/admin");
  revalidatePath("/dashboard/billing");
  revalidatePath("/");
}

/**
 * Attach a Grow payment that arrived with no matching account to an org by
 * hand — the fallback for when the payer used a phone/email on Grow's page
 * that matches nothing we have, so the automatic claim never fired.
 */
export async function claimPaymentForOrgAction(formData: FormData): Promise<void> {
  await requireSuperAdmin();
  const orgId = String(formData.get("orgId") ?? "");
  const paymentId = String(formData.get("paymentId") ?? "");
  if (!orgId || !paymentId) return;
  await claimPaymentById(orgId, paymentId);
  revalidatePath("/admin");
  revalidatePath("/dashboard/billing");
}

/** Save price + limits for one plan — overrides the hardcoded defaults everywhere they're read. */
export async function savePlanConfigAction(formData: FormData): Promise<void> {
  await requireSuperAdmin();
  const id = String(formData.get("id") ?? "") as PlanId;
  if (!(id in PLANS)) return;

  const num = (name: string, fallback: number) => {
    const v = Number(formData.get(name));
    return Number.isFinite(v) && v >= 0 ? Math.round(v) : fallback;
  };
  // Price alone may carry agorot — the Grow products aren't whole shekels.
  const rawPrice = Number(formData.get("priceIls"));
  const priceIls =
    Number.isFinite(rawPrice) && rawPrice >= 0 ? Math.round(rawPrice * 100) / 100 : PLANS[id].priceIls;

  const data = {
    priceIls,
    connections: num("connections", PLANS[id].limits.connections),
    contacts: num("contacts", PLANS[id].limits.contacts),
    monthlyMessages: num("monthlyMessages", PLANS[id].limits.monthlyMessages),
    products: num("products", PLANS[id].limits.products),
  };
  await prisma.planConfig.upsert({ where: { id }, create: { id, ...data }, update: data });
  revalidatePath("/admin");
  revalidatePath("/dashboard/billing");
  revalidatePath("/");
}

/** Save the PLATFORM Meta / Embedded Signup config (stored on the platform org). */
export async function savePlatformMetaAction(formData: FormData): Promise<void> {
  const { org } = await requireSuperAdmin();
  const map: Array<[string, string]> = [
    [META_SECRETS.appId, String(formData.get("app_id") ?? "").trim()],
    [META_SECRETS.appSecret, String(formData.get("app_secret") ?? "").trim()],
    [META_SECRETS.configId, String(formData.get("config_id") ?? "").trim()],
    [META_SECRETS.webhookVerifyToken, String(formData.get("verify_token") ?? "").trim()],
    [META_SECRETS.graphVersion, String(formData.get("graph_version") ?? "").trim()],
  ];
  for (const [name, value] of map) if (value) await setSecret(org, name, value);
  revalidatePath("/admin");
}

export async function removePlatformMetaAction(): Promise<void> {
  const { org } = await requireSuperAdmin();
  for (const name of Object.values(META_SECRETS)) await deleteSecret(org, name);
  revalidatePath("/admin");
}
