"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@kesher/db";
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

/**
 * Save the Cal.com webhook signing secret — or, only when explicitly asked,
 * clear it.
 *
 * An empty field means "leave it alone", never "delete it". The input renders
 * blank on every load (the stored secret is shown as a masked placeholder, and
 * a password is never sent back to the browser), so treating empty as a delete
 * turned an idle Save on this page into a silent teardown of the integration:
 * the secret vanished, Cal.com kept POSTing, every delivery was rejected 401,
 * and bookings stopped reaching the CRM with nothing in the UI to show why.
 */
export async function saveCalcomWebhookSecretAction(formData: FormData): Promise<void> {
  const org = await requireOrg();
  if (formData.get("clear") === "1") {
    await deleteSecret(org, "calcom_webhook_secret");
    revalidatePath("/dashboard/settings");
    return;
  }
  const value = String(formData.get("secret") ?? "").trim();
  if (value) await setSecret(org, "calcom_webhook_secret", value);
  revalidatePath("/dashboard/settings");
}
