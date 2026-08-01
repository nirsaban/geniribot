import { NextResponse } from "next/server";
import type { GrowCallback } from "@kesher/billing";
import { applyGrowPayment } from "@/lib/subscriptions";

export const dynamic = "force-dynamic";

/**
 * Grow (Meshulam) payment callback — fires on the first charge AND on every
 * recurring renewal of the managed payment page. Our custom field carries
 * cField1 = organizationId (set when we generated the link via /dashboard or
 * /admin; absent for a raw static-page payment, parked as unclaimed).
 *
 * Security: the callback itself is unauthenticated and we do not call back
 * into Grow to verify it (no API/Make integration) — `applyGrowPayment`
 * derives the plan/interval from the charged sum against known plan prices
 * rather than trusting the plan/interval fields directly, and deliveries are
 * deduped by transaction id. This does NOT stop a forged POST carrying a
 * real org id and a sum that matches a real plan price from activating that
 * plan for free — acceptable for now given no live Grow API access, but
 * worth revisiting if that risk matters more later.
 */
export async function POST(req: Request) {
  let flat: Record<string, string> = {};
  const ct = req.headers.get("content-type") ?? "";
  try {
    if (ct.includes("application/json")) {
      flat = (await req.json()) as Record<string, string>;
    } else {
      const form = await req.formData();
      for (const [k, v] of form.entries()) flat[k] = String(v);
    }
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  // Grow POSTs form-encoded bracket notation, everything nested under
  // "data[...]" (and custom fields nested again under "data[customFields][...]")
  // — the same wrapper shape as its other API responses. Flatten it back out.
  const raw: GrowCallback = {
    err: flat["err"],
    status: flat["data[status]"] ?? flat["status"],
    statusCode: flat["data[statusCode]"],
    transactionTypeId: flat["data[transactionTypeId]"],
    paymentType: flat["data[paymentType]"],
    sum: flat["data[sum]"],
    paymentDate: flat["data[paymentDate]"],
    description: flat["data[description]"],
    fullName: flat["data[fullName]"],
    payerPhone: flat["data[payerPhone]"],
    payerEmail: flat["data[payerEmail]"],
    processId: flat["data[processId]"],
    processToken: flat["data[processToken]"],
    transactionId: flat["data[transactionId]"],
    transactionToken: flat["data[transactionToken]"],
    asmachta: flat["data[asmachta]"],
    cardSuffix: flat["data[cardSuffix]"],
    cardBrand: flat["data[cardBrand]"],
    cField1: flat["data[customFields][cField1]"],
    cField2: flat["data[customFields][cField2]"],
    cField3: flat["data[customFields][cField3]"],
  };

  const ok = raw.statusCode === "2" || raw.status === "1" || raw.status === "success";
  if (!ok) return NextResponse.json({ ok: false, error: "not_successful" }, { status: 400 });

  const result = await applyGrowPayment(raw);

  return NextResponse.json({ ok: true, applied: result.applied, reason: result.reason });
}
