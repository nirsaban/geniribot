"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { planLimits, type PlanId } from "@kesher/billing";
import { prisma, type Prisma } from "@kesher/db";
import { encField } from "@/lib/enc";
import { gatewayConnect, gatewayLogout } from "@/lib/gateway";
import { getSession } from "@/lib/session";

async function atConnectionLimit(org: string): Promise<boolean> {
  const orgRow = await prisma.organization.findUnique({ where: { id: org }, select: { plan: true } });
  const limit = planLimits((orgRow?.plan ?? "FREE") as PlanId).connections;
  const existing = await prisma.whatsAppConnection.count({ where: { organizationId: org } });
  return existing >= limit;
}

async function activeFlowId(org: string): Promise<string | null> {
  const flow = await prisma.flow.findFirst({
    where: { organizationId: org, isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return flow?.id ?? null;
}

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
  if (await atConnectionLimit(org)) redirect("/dashboard/billing?limit=connections");

  const conn = await prisma.whatsAppConnection.create({
    data: { organizationId: org, label, provider: "baileys", defaultFlowId: await activeFlowId(org) },
  });

  await gatewayConnect(conn.id, org).catch(() => {
    /* gateway may be starting; the page can retry via reconnect */
  });
  revalidatePath("/dashboard/connections");
}

/** Create an official WhatsApp Cloud API connection (no QR — token-based). */
export async function createCloudConnectionAction(formData: FormData): Promise<void> {
  const org = await requireOrg();
  const label = String(formData.get("label") ?? "").trim() || "Cloud API";
  const phoneNumberId = String(formData.get("phone_number_id") ?? "").trim();
  const accessToken = String(formData.get("access_token") ?? "").trim();
  const verifyToken =
    String(formData.get("verify_token") ?? "").trim() || Math.random().toString(36).slice(2);
  if (!phoneNumberId || !accessToken) redirect("/dashboard/connections?err=cloud_fields");
  if (await atConnectionLimit(org)) redirect("/dashboard/billing?limit=connections");

  const authState = {
    kind: "cloud_api",
    phoneNumberId,
    verifyToken,
    accessTokenEnc: encField(accessToken),
  };

  const conn = await prisma.whatsAppConnection.create({
    data: {
      organizationId: org,
      label,
      provider: "cloud_api",
      status: "CONNECTED",
      phoneNumber: phoneNumberId,
      authState: authState as Prisma.InputJsonValue,
      defaultFlowId: await activeFlowId(org),
    },
  });
  await gatewayConnect(conn.id, org).catch(() => {});
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
