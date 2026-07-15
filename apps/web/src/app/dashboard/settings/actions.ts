"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@kesher/db";
import { getSession } from "@/lib/session";

export async function disconnectGoogleAction(): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/login");
  await prisma.calendarIntegration.deleteMany({
    where: { organizationId: session.org, userId: session.sub, provider: "google" },
  });
  revalidatePath("/dashboard/settings");
}
