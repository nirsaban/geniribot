import { NextResponse } from "next/server";
import { completeEmbeddedSignup } from "@kesher/whatsapp";
import { planLimits } from "@kesher/billing";
import { prisma, type Prisma } from "@kesher/db";
import { encField } from "@/lib/enc";
import { gatewayConnect } from "@/lib/gateway";
import { metaServerConfig } from "@/lib/meta";
import { effectivePlanForOrg } from "@/lib/plan";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Completes WhatsApp Embedded Signup (direct-to-Meta). The browser (FB.login)
 * posts { code, phone_number_id, waba_id }; we exchange the code for the
 * customer's business token, register the number for Cloud API, subscribe our
 * app to their WABA, then persist a `cloud_api` connection. Plan-gated so extra
 * numbers require a paid plan (same limit the manual/QR paths enforce).
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const org = session.org;

  let body: { code?: string; phone_number_id?: string; waba_id?: string; label?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }
  const code = body.code?.trim();
  const phoneNumberId = body.phone_number_id?.trim();
  const wabaId = body.waba_id?.trim();
  if (!code || !phoneNumberId || !wabaId) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  // Plan gate (mirror connections/actions.ts atConnectionLimit).
  const limit = planLimits(await effectivePlanForOrg(org)).connections;
  const existing = await prisma.whatsAppConnection.count({ where: { organizationId: org } });
  if (existing >= limit) {
    return NextResponse.json({ error: "connection_limit", limit }, { status: 402 });
  }

  const cfg = await metaServerConfig();
  if (!cfg) {
    return NextResponse.json({ error: "meta_not_configured" }, { status: 503 });
  }

  // 6-digit 2FA PIN for phone-number registration (stored encrypted for re-register).
  const pin = String(Math.floor(100000 + Math.random() * 900000));

  let result;
  try {
    result = await completeEmbeddedSignup({ code, phoneNumberId, wabaId, pin }, cfg);
  } catch (e) {
    return NextResponse.json(
      { error: "onboarding_failed", detail: (e as Error).message },
      { status: 502 },
    );
  }

  const label =
    body.label?.trim() || result.displayPhoneNumber || `WhatsApp ${phoneNumberId.slice(-4)}`;

  const activeFlow = await prisma.flow.findFirst({
    where: { organizationId: org, isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  const authState = {
    kind: "cloud_api",
    phoneNumberId: result.phoneNumberId,
    wabaId: result.wabaId,
    accessTokenEnc: encField(result.accessToken),
    pinEnc: encField(pin),
  };

  const conn = await prisma.whatsAppConnection.create({
    data: {
      organizationId: org,
      label,
      provider: "cloud_api",
      status: "CONNECTED",
      phoneNumber: result.displayPhoneNumber ?? phoneNumberId,
      wabaId: result.wabaId,
      displayPhoneNumber: result.displayPhoneNumber,
      authState: authState as Prisma.InputJsonValue,
      defaultFlowId: activeFlow?.id ?? null,
    },
  });
  await gatewayConnect(conn.id, org).catch(() => {});

  return NextResponse.json({ ok: true, connectionId: conn.id, phoneNumber: conn.phoneNumber });
}
