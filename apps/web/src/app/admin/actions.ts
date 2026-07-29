"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { PLANS, type PlanId } from "@kesher/billing";
import { prisma } from "@kesher/db";
import { GROW_SECRETS } from "@/lib/billing";
import { META_SECRETS } from "@/lib/meta";
import { deleteSecret, setSecret } from "@/lib/secrets";
import { getSession } from "@/lib/session";

async function requireSuperAdmin(): Promise<{ org: string }> {
  const s = await getSession();
  if (!s?.sa) redirect("/dashboard");
  return { org: s.org };
}

/** Super admin manually sets (unlocks) any org's plan. */
export async function setOrgPlanAction(formData: FormData): Promise<void> {
  await requireSuperAdmin();
  const orgId = String(formData.get("orgId") ?? "");
  const plan = String(formData.get("plan") ?? "") as PlanId;
  if (!(plan in PLANS)) return;
  await prisma.organization.update({ where: { id: orgId }, data: { plan } });
  revalidatePath("/admin");
}

/** Save the PLATFORM Grow-via-Make webhook URLs (stored on the platform org). */
export async function savePlatformGrowAction(formData: FormData): Promise<void> {
  const { org } = await requireSuperAdmin();
  const map: Array<[string, string]> = [
    [GROW_SECRETS.createCheckoutWebhookUrl, String(formData.get("create_checkout_url") ?? "").trim()],
    [GROW_SECRETS.verifyWebhookUrl, String(formData.get("verify_url") ?? "").trim()],
    [GROW_SECRETS.chargeTokenWebhookUrl, String(formData.get("charge_token_url") ?? "").trim()],
  ];
  for (const [name, value] of map) if (value) await setSecret(org, name, value);
  revalidatePath("/admin");
}

export async function removePlatformGrowAction(): Promise<void> {
  const { org } = await requireSuperAdmin();
  for (const name of Object.values(GROW_SECRETS)) await deleteSecret(org, name);
  revalidatePath("/admin");
}

/** Save the static Grow payment page URL (landing page + billing page fallback). */
export async function savePlatformPaymentUrlAction(formData: FormData): Promise<void> {
  const { org } = await requireSuperAdmin();
  const url = String(formData.get("url") ?? "").trim();
  await prisma.organization.update({ where: { id: org }, data: { growPaymentUrl: url || null } });
  revalidatePath("/admin");
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
  const data = {
    priceIls: num("priceIls", PLANS[id].priceIls),
    annualIls: num("annualIls", PLANS[id].annualIls),
    connections: num("connections", PLANS[id].limits.connections),
    contacts: num("contacts", PLANS[id].limits.contacts),
    monthlyMessages: num("monthlyMessages", PLANS[id].limits.monthlyMessages),
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
