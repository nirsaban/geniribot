"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@kesher/db";
import { getSession } from "@/lib/session";

async function requireOrg(): Promise<string> {
  const s = await getSession();
  if (!s) redirect("/login");
  return s.org;
}

export async function finishOnboardingAction(): Promise<void> {
  const org = await requireOrg();
  await prisma.organization.update({ where: { id: org }, data: { onboardedAt: new Date() } });
  redirect("/dashboard");
}

/** Save the tenant's own Cal.com booking link (the bot will send it). */
export async function saveCalcomLinkAction(formData: FormData): Promise<void> {
  const org = await requireOrg();
  let link = String(formData.get("calcom") ?? "").trim();
  if (link && !/^https?:\/\//i.test(link)) link = `https://${link}`;
  await prisma.organization.update({ where: { id: org }, data: { calcomLink: link || null } });
  revalidatePath("/dashboard/onboarding");
  revalidatePath("/dashboard/settings");
}

/** Switch back to in-chat slot booking (clear the Cal.com link). */
export async function useInChatBookingAction(): Promise<void> {
  const org = await requireOrg();
  await prisma.organization.update({ where: { id: org }, data: { calcomLink: null } });
  revalidatePath("/dashboard/onboarding");
}
