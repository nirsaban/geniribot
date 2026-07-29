import { NextResponse } from "next/server";
import type { GrowCallback } from "@kesher/billing";
import { growPlatformProvider } from "@/lib/billing";
import { applyGrowPayment } from "@/lib/subscriptions";

export const dynamic = "force-dynamic";

/**
 * Grow (Meshulam) payment callback — fires on the first charge AND on every
 * recurring renewal of the managed payment page. Our custom fields carry
 * cField1 = organizationId, cField2 = plan, cField3 = interval.
 *
 * Security: the callback itself is unauthenticated, so we NEVER trust it
 * directly. We re-fetch the transaction from Grow (`getPaymentProcessInfo`) and
 * only act on the authoritative result — that Make scenario also acks the
 * transaction with Grow's `approveTransaction` internally. Deliveries are
 * deduped by transaction id (see `applyGrowPayment`).
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

  const provider = await growPlatformProvider();
  if (!provider) {
    // Cannot verify without platform credentials — refuse to act on an
    // unverifiable callback rather than trust it.
    return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
  }

  const processId = raw.processId;
  const processToken = raw.processToken;
  if (!processId || !processToken) {
    return NextResponse.json({ ok: false, error: "missing_process" }, { status: 400 });
  }

  const verified = await provider.verifyTransaction(processId, processToken, raw.transactionId, raw.transactionToken);
  if (!verified) {
    // Not a real, successful transaction — ignore.
    return NextResponse.json({ ok: false, error: "unverified" }, { status: 400 });
  }

  // Authoritative data wins; keep our echoed custom fields if Grow omits them.
  const cb: GrowCallback = { ...raw, ...stripUndefined(verified) };
  cb.cField1 = verified.cField1 ?? raw.cField1;
  cb.cField2 = verified.cField2 ?? raw.cField2;
  cb.cField3 = verified.cField3 ?? raw.cField3;

  // verifyTransaction's Make scenario also approves the transaction with Grow
  // internally — no separate approve call needed here.
  const result = await applyGrowPayment(cb);

  return NextResponse.json({ ok: true, applied: result.applied, reason: result.reason });
}

function stripUndefined(o: GrowCallback): GrowCallback {
  const out: GrowCallback = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out;
}
