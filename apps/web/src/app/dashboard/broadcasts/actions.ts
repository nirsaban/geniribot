"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@kesher/db";
import { collectAudience } from "@/lib/audience";
import { gatewayCreateGroup } from "@/lib/gateway";
import { getSession } from "@/lib/session";

async function requireOrg(): Promise<string> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session.org;
}

/** Create a broadcast (immediate or scheduled) with its resolved recipients. */
export async function createBroadcastAction(formData: FormData): Promise<void> {
  const org = await requireOrg();
  const name = String(formData.get("name") ?? "").trim();
  const message = String(formData.get("message") ?? "").trim();
  if (!name || !message) redirect("/dashboard/broadcasts/new?error=missing");

  const recipients = await collectAudience(org, formData);
  if (recipients.length === 0) redirect("/dashboard/broadcasts/new?error=empty");

  // "Schedule" only counts when the mode says so AND the time parses; a bad
  // datetime falls back to sending now rather than parking the campaign forever.
  let scheduledAt: Date | null = null;
  if (formData.get("when") === "at") {
    const t = new Date(String(formData.get("scheduledAt") ?? ""));
    if (!Number.isNaN(t.getTime())) scheduledAt = t;
  }

  const broadcast = await prisma.broadcast.create({
    data: {
      organizationId: org,
      name,
      message,
      scheduledAt,
      status: "SCHEDULED",
      totalCount: recipients.length,
      recipients: {
        create: recipients.map((r) => ({
          phone: r.phone,
          name: r.name,
          contactId: r.contactId,
        })),
      },
    },
  });

  revalidatePath("/dashboard/broadcasts");
  redirect(`/dashboard/broadcasts/${broadcast.id}`);
}

/** Stop a broadcast that hasn't finished; already-enqueued messages still go. */
export async function cancelBroadcastAction(formData: FormData): Promise<void> {
  const org = await requireOrg();
  const id = String(formData.get("id") ?? "");
  await prisma.broadcast.updateMany({
    where: { id, organizationId: org, status: { in: ["SCHEDULED", "SENDING"] } },
    data: { status: "CANCELLED" },
  });
  await prisma.broadcastRecipient.updateMany({
    where: { broadcastId: id, status: "PENDING" },
    data: { status: "FAILED", error: "cancelled" },
  });
  revalidatePath("/dashboard/broadcasts");
  revalidatePath(`/dashboard/broadcasts/${id}`);
}

/** Create a WhatsApp group from an audience and optionally post a welcome. */
export async function createGroupAction(formData: FormData): Promise<void> {
  const org = await requireOrg();
  const subject = String(formData.get("subject") ?? "").trim();
  const welcome = String(formData.get("welcome") ?? "").trim();
  if (!subject) redirect("/dashboard/groups?error=missing");

  const conn = await prisma.whatsAppConnection.findFirst({
    where: { organizationId: org, status: "CONNECTED", provider: { not: "cloud_api" } },
    select: { id: true },
  });
  if (!conn) redirect("/dashboard/groups?error=no_connection");

  const recipients = await collectAudience(org, formData);
  if (recipients.length === 0) redirect("/dashboard/groups?error=empty");

  try {
    const result = await gatewayCreateGroup(
      conn.id,
      subject,
      recipients.map((r) => r.phone),
      welcome || undefined,
    );
    redirect(
      `/dashboard/groups?created=1&added=${result.added.length}&failed=${result.failed.length}`,
    );
  } catch (err) {
    // redirect() throws internally — let those through, report real failures.
    if ((err as { digest?: string }).digest?.startsWith("NEXT_REDIRECT")) throw err;
    redirect("/dashboard/groups?error=gateway");
  }
}
