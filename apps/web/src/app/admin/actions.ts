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

/** Save the PLATFORM Grow credentials (stored on the platform org). */
export async function savePlatformGrowAction(formData: FormData): Promise<void> {
  const { org } = await requireSuperAdmin();
  const map: Array<[string, string]> = [
    [GROW_SECRETS.pageCode, String(formData.get("page_code") ?? "").trim()],
    [GROW_SECRETS.userId, String(formData.get("user_id") ?? "").trim()],
    [GROW_SECRETS.apiKey, String(formData.get("api_key") ?? "").trim()],
  ];
  for (const [name, value] of map) if (value) await setSecret(org, name, value);
  revalidatePath("/admin");
}

export async function removePlatformGrowAction(): Promise<void> {
  const { org } = await requireSuperAdmin();
  for (const name of Object.values(GROW_SECRETS)) await deleteSecret(org, name);
  revalidatePath("/admin");
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
