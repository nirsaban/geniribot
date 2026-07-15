import { NextResponse } from "next/server";
import { parseCloudWebhook } from "@kesher/whatsapp";
import { prisma } from "@kesher/db";
import { inboundQueue } from "@/lib/inboundQueue";

export const dynamic = "force-dynamic";

/**
 * Public WhatsApp Cloud API webhook (Meta calls this URL).
 * - GET:  verification handshake (echo hub.challenge if the verify token matches
 *         any configured Cloud connection).
 * - POST: inbound message events → normalize → enqueue on wa-inbound (the same
 *         queue the Baileys path uses), routed to the connection by phone_number_id.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token) {
    const conns = await prisma.whatsAppConnection.findMany({
      where: { provider: "cloud_api" },
      select: { authState: true },
    });
    const ok = conns.some((c) => (c.authState as { verifyToken?: string } | null)?.verifyToken === token);
    if (ok) return new NextResponse(challenge ?? "", { status: 200 });
  }
  return new NextResponse("forbidden", { status: 403 });
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const messages = parseCloudWebhook(body);
  if (messages.length === 0) return NextResponse.json({ ok: true });

  // Route each message to its connection by phone_number_id.
  const cloud = await prisma.whatsAppConnection.findMany({
    where: { provider: "cloud_api" },
    select: { id: true, organizationId: true, authState: true },
  });
  const byPnid = new Map<string, { id: string; organizationId: string }>();
  for (const c of cloud) {
    const pnid = (c.authState as { phoneNumberId?: string } | null)?.phoneNumberId;
    if (pnid) byPnid.set(pnid, { id: c.id, organizationId: c.organizationId });
  }

  for (const m of messages) {
    const conn = byPnid.get(m.phoneNumberId);
    if (!conn) continue;
    await inboundQueue.add(
      "inbound",
      {
        organizationId: conn.organizationId,
        connectionId: conn.id,
        from: m.from,
        text: m.text,
        externalId: m.externalId,
      },
      { jobId: `${conn.id}_${m.externalId.replace(/:/g, "-")}` },
    );
  }
  return NextResponse.json({ ok: true });
}
