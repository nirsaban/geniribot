"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@kesher/db";
import { GROW_SECRETS } from "@/lib/billing";
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
