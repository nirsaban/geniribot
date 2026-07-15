"use server";

import { redirect } from "next/navigation";
import { prisma } from "@kesher/db";
import { getSession } from "@/lib/session";

export async function finishOnboardingAction(): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/login");
  await prisma.organization.update({
    where: { id: session.org },
    data: { onboardedAt: new Date() },
  });
  redirect("/dashboard");
}
