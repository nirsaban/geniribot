import { NextResponse } from "next/server";
import { chargeOrgCardToken } from "@/lib/subscriptions";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Super admin charges an org's saved Grow card token for an arbitrary amount — no payment link. */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.sa) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { orgId, sumIls, description } = (await req.json()) as {
    orgId?: string;
    sumIls?: number;
    description?: string;
  };
  if (!orgId || !sumIls || !(sumIls > 0) || !description?.trim()) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const result = await chargeOrgCardToken(orgId, Math.round(sumIls), description.trim());
  if (!result.ok) return NextResponse.json({ error: result.error ?? "charge_failed" }, { status: 400 });
  return NextResponse.json({ ok: true, transactionId: result.transactionId });
}
