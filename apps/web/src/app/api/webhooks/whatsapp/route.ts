import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { parseCloudWebhook } from "@kesher/whatsapp";
import { prisma } from "@kesher/db";
import { inboundQueue } from "@/lib/inboundQueue";
import { metaAppSecret, metaWebhookVerifyToken } from "@/lib/meta";

export const dynamic = "force-dynamic";

/**
 * Public WhatsApp Cloud API webhook (Meta calls this URL).
 * - GET:  verification handshake. Embedded Signup uses ONE app-level verify
 *         token (META_WEBHOOK_VERIFY_TOKEN); we also accept any manually-added
 *         connection's per-connection token (Phase 8 back-compat).
 * - POST: inbound events → verify X-Hub-Signature-256 (HMAC-SHA256 w/ app secret)
 *         → normalize → enqueue on wa-inbound, routed by phone_number_id.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode !== "subscribe" || !token) return new NextResponse("forbidden", { status: 403 });

  // App-level token (Embedded Signup).
  const appToken = await metaWebhookVerifyToken();
  if (appToken && token === appToken) return new NextResponse(challenge ?? "", { status: 200 });

  // Back-compat: per-connection verify token from a manually-added Cloud connection.
  const conns = await prisma.whatsAppConnection.findMany({
    where: { provider: "cloud_api" },
    select: { authState: true },
  });
  const ok = conns.some((c) => (c.authState as { verifyToken?: string } | null)?.verifyToken === token);
  if (ok) return new NextResponse(challenge ?? "", { status: 200 });

  return new NextResponse("forbidden", { status: 403 });
}

/** Constant-time compare of the sha256 signature header against the raw body. */
function verifySignature(raw: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const expected = "sha256=" + createHmac("sha256", secret).update(raw, "utf8").digest("hex");
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  const raw = await req.text();

  // Verify the payload signature when an app secret is configured.
  const secret = await metaAppSecret();
  if (secret) {
    const sig = req.headers.get("x-hub-signature-256");
    if (!verifySignature(raw, sig, secret)) {
      return NextResponse.json({ error: "bad_signature" }, { status: 401 });
    }
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
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
