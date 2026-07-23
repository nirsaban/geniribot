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
 * only act on the authoritative result. Deliveries are deduped by transaction
 * id (see `applyGrowPayment`), and we ack Grow with `approveTransaction`.
 */
export async function POST(req: Request) {
  let raw: GrowCallback = {};
  const ct = req.headers.get("content-type") ?? "";
  try {
    if (ct.includes("application/json")) {
      raw = (await req.json()) as GrowCallback;
    } else {
      const form = await req.formData();
      for (const [k, v] of form.entries()) raw[k] = String(v);
    }
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

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

  const verified = await provider.verifyTransaction(processId, processToken);
  if (!verified) {
    // Not a real, successful transaction — ignore.
    return NextResponse.json({ ok: false, error: "unverified" }, { status: 400 });
  }

  // Authoritative data wins; keep our echoed custom fields if Grow omits them.
  const cb: GrowCallback = { ...raw, ...stripUndefined(verified) };
  cb.cField1 = verified.cField1 ?? raw.cField1;
  cb.cField2 = verified.cField2 ?? raw.cField2;
  cb.cField3 = verified.cField3 ?? raw.cField3;

  const result = await applyGrowPayment(cb);

  // Best-effort acknowledgement back to Grow.
  await provider.approveTransaction(cb);

  return NextResponse.json({ ok: true, applied: result.applied, reason: result.reason });
}

function stripUndefined(o: GrowCallback): GrowCallback {
  const out: GrowCallback = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out;
}
