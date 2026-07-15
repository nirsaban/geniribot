import { NextResponse } from "next/server";
import { PLANS, type PlanId } from "@kesher/billing";
import { prisma } from "@kesher/db";

export const dynamic = "force-dynamic";

/**
 * Grow (Meshulam) payment callback. Grow POSTs the transaction result with our
 * custom fields (cField1 = organizationId, cField2 = plan). On success we set
 * the org's plan. Accepts form-encoded or JSON.
 *
 * NOTE: production should additionally verify via Grow's getPaymentProcessInfo
 * (or a signature) before trusting the callback — TODO once we have a merchant
 * account to test against.
 */
export async function POST(req: Request) {
  let data: Record<string, string> = {};
  const ct = req.headers.get("content-type") ?? "";
  try {
    if (ct.includes("application/json")) {
      data = (await req.json()) as Record<string, string>;
    } else {
      const form = await req.formData();
      for (const [k, v] of form.entries()) data[k] = String(v);
    }
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const orgId = data.cField1 ?? data.organizationId;
  const plan = (data.cField2 ?? data.plan) as PlanId | undefined;
  const status = data.status ?? data.statusCode;

  if (orgId && plan && plan in PLANS && (status === "1" || status === undefined)) {
    await prisma.organization
      .update({ where: { id: orgId }, data: { plan } })
      .catch(() => {});
  }
  return NextResponse.json({ ok: true });
}
