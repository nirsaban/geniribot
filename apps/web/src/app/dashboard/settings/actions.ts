"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@kesher/db";
import { GROW_SECRETS } from "@/lib/billing";
import { requireFeature } from "@/lib/plan";
import { deleteSecret, setSecret } from "@/lib/secrets";
import { getSession } from "@/lib/session";

async function requireOrg(): Promise<string> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session.org;
}

export async function disconnectGoogleAction(): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/login");
  await prisma.calendarIntegration.deleteMany({
    where: { organizationId: session.org, userId: session.sub, provider: "google" },
  });
  revalidatePath("/dashboard/settings");
}

/** Save the org's automatic cold-lead follow-up policy. */
export async function saveFollowUpAction(formData: FormData): Promise<void> {
  const org = await requireOrg();
  // Clamp rather than reject: a plan that lost the feature (downgrade, lapsed
  // subscription) simply can't turn it on, regardless of what was submitted.
  const enabled = formData.get("enabled") === "1" && (await requireFeature(org, "followups"));
  // Clamp instead of reject: a bad hand-typed number should degrade to a sane
  // policy, not silently disable follow-ups.
  const afterHours = Math.min(24 * 14, Math.max(1, Number(formData.get("afterHours")) || 48));
  const max = Math.min(5, Math.max(1, Number(formData.get("max")) || 2));
  const message = String(formData.get("message") ?? "").trim();
  await prisma.organization.update({
    where: { id: org },
    data: {
      followUpEnabled: enabled,
      followUpAfterHours: afterHours,
      followUpMax: max,
      followUpMessage: message || null,
    },
  });
  revalidatePath("/dashboard/settings");
}

/** Save (or clear) the Cal.com webhook signing secret. */
export async function saveCalcomWebhookSecretAction(formData: FormData): Promise<void> {
  const org = await requireOrg();
  const value = String(formData.get("secret") ?? "").trim();
  if (value) await setSecret(org, "calcom_webhook_secret", value);
  else await deleteSecret(org, "calcom_webhook_secret");
  revalidatePath("/dashboard/settings");
}

/** Save pasted Grow secrets (encrypted). Only non-empty fields are updated. */
export async function saveGrowSecretsAction(formData: FormData): Promise<void> {
  const org = await requireOrg();
  const map: Array<[string, string]> = [
    [GROW_SECRETS.pageCode, String(formData.get("page_code") ?? "").trim()],
    [GROW_SECRETS.userId, String(formData.get("user_id") ?? "").trim()],
    [GROW_SECRETS.apiKey, String(formData.get("api_key") ?? "").trim()],
  ];
  for (const [name, value] of map) {
    if (value) await setSecret(org, name, value);
  }
  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard/onboarding");
}

export async function removeGrowSecretsAction(): Promise<void> {
  const org = await requireOrg();
  for (const name of Object.values(GROW_SECRETS)) await deleteSecret(org, name);
  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard/onboarding");
}
