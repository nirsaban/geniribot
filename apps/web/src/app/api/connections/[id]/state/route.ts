import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { prisma } from "@kesher/db";
import { safeGatewayState } from "@/lib/gateway";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Browser-polled endpoint for a connection's live status + QR. The gateway's
 * internal token stays server-side; the QR string is rendered to a data-URL
 * image here so the client just displays it.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const conn = await prisma.whatsAppConnection.findFirst({
    where: { id, organizationId: session.org },
    select: { id: true, status: true },
  });
  if (!conn) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const state = await safeGatewayState(id);
  const status = state?.status ?? conn.status.toLowerCase();
  let qrImage: string | null = null;
  if (state?.qr) {
    qrImage = await QRCode.toDataURL(state.qr, { margin: 1, width: 264 });
  }

  return NextResponse.json({ status, qrImage });
}
