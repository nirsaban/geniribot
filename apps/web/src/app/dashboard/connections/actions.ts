"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@kesher/db";
import { gatewayConnect, gatewayLogout } from "@/lib/gateway";
import { getSession } from "@/lib/session";

async function requireOrg(): Promise<string> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session.org;
}

/** Verify a connection belongs to the caller's org (tenant guard). */
async function ownedConnection(org: string, id: string) {
  const conn = await prisma.whatsAppConnection.findFirst({
    where: { id, organizationId: org },
    select: { id: true },
  });
  if (!conn) redirect("/dashboard/connections");
  return conn;
}

export async function createConnectionAction(formData: FormData): Promise<void> {
  const org = await requireOrg();
  const label = String(formData.get("label") ?? "").trim() || "וואטסאפ";

  // Attach the org's active flow as the default greeter, if any.
  const flow = await prisma.flow.findFirst({
    where: { organizationId: org, isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  const conn = await prisma.whatsAppConnection.create({
    data: { organizationId: org, label, defaultFlowId: flow?.id ?? null },
  });

  await gatewayConnect(conn.id, org).catch(() => {
    /* gateway may be starting; the page can retry via reconnect */
  });
  revalidatePath("/dashboard/connections");
}

export async function reconnectAction(formData: FormData): Promise<void> {
  const org = await requireOrg();
  const id = String(formData.get("id") ?? "");
  await ownedConnection(org, id);
  await gatewayConnect(id, org).catch(() => {});
  revalidatePath("/dashboard/connections");
}

export async function logoutConnectionAction(formData: FormData): Promise<void> {
  const org = await requireOrg();
  const id = String(formData.get("id") ?? "");
  await ownedConnection(org, id);
  await gatewayLogout(id).catch(() => {});
  await prisma.whatsAppConnection.update({
    where: { id },
    data: { status: "LOGGED_OUT", authState: undefined },
  });
  revalidatePath("/dashboard/connections");
}
